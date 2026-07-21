import { buildChallengeMessage, buildCreatorOfferActionMessage, buildLoginChallengeMessage, decodePublicKey, isValidAgentName, parseRole, sha256, verifyWalletSignature } from './security'
import { parseOfferKind, validateOfferTerms } from './negotiation'
import { buildVideoSubmissionMessage, canonicalYoutubeUrl, getYoutubeVideoId } from './youtube'
import { fetchDevnetTransaction, SOLANA_DEVNET_USDC_MINT, verifyDevnetUsdcDelegation, verifyDevnetUsdcPayment, verifyDevnetUsdcRevocation, VIDEO_PAYMENT_AMOUNT_BASE_UNITS, VIDEO_PAYMENT_AMOUNT_USDC } from './solana'
import { isPayoutWithinLimits, recommendCreatorPayout } from './payout-policy'

interface Env {
  DB: D1Database
  ALLOWED_ORIGIN?: string
  SOLANA_RPC_URL?: string
}

type JsonRecord = Record<string, unknown>
type AgentRow = { id: string; name: string; role: 'brand' | 'creator'; wallet: string }
type CampaignRow = { id: string; title: string; brand_agent_id: string; creator_agent_id: string | null; status: 'negotiating' | 'accepted' | 'cancelled'; accepted_offer_id: string | null; created_at: string; updated_at: string }
type VideoSubmissionRow = { id: string; campaign_id: string; campaign_title: string; creator_agent_id: string; creator_name: string; video_id: string; youtube_url: string; title: string; channel_title: string; thumbnail_url: string | null; verification_status: 'public_verified' | 'channel_verified'; creator_signed: number; created_at: string; verified_at: string }
type PaymentRow = { id: string; campaign_id: string; campaign_title: string; milestone: 'video_publication'; sender_wallet: string; authority_wallet: string | null; recipient_wallet: string; mint: string; amount_base_units: string; amount_usdc: string; memo: string; status: 'requested' | 'confirmed'; transaction_signature: string | null; created_at: string; confirmed_at: string | null }
type DelegationRow = { id: string; brand_agent_id: string; campaign_id: string | null; owner_wallet: string; delegate_wallet: string; token_account: string; mint: string; allowance_base_units: string; approval_signature: string; status: 'active' | 'revoked'; created_at: string; revoked_at: string | null; revocation_signature: string | null }
type CreatorOfferV2Row = {
  id: string; campaign_id: string; campaign_title?: string; brand_agent_id: string; creator_name: string; youtube_channel: string; creator_wallet: string | null;
  fit_score: number; amount_base_units: string; amount_usdc: string; ai_rationale: string; status: 'proposed' | 'accepted' | 'submitted' | 'verified' | 'paid' | 'rejected' | 'expired';
  video_id: string | null; youtube_url: string | null; video_title: string | null; verified_channel_title: string | null; thumbnail_url: string | null;
  creator_signature: string | null; expires_at: string; accepted_at: string | null; submitted_at: string | null; verified_at: string | null; paid_at: string | null; created_at: string; updated_at: string
}
type CreatorPaymentV2Row = { id: string; offer_id: string; campaign_id: string; brand_agent_id: string; sender_wallet: string; authority_wallet: string; recipient_wallet: string; mint: string; amount_base_units: string; amount_usdc: string; memo: string; status: 'prepared' | 'confirmed'; transaction_signature: string | null; created_at: string; confirmed_at: string | null }
type PipelineRow = {
  creator_id: string; creator_name: string; creator_wallet: string; campaign_id: string | null; campaign_title: string | null;
  campaign_status: string | null; offered_amount: string | null; video_id: string | null; youtube_url: string | null;
  channel_title: string | null; video_title: string | null; verification_status: string | null; creator_signed: number | null;
  payment_status: string | null; transaction_signature: string | null; updated_at: string
}

function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get('origin') ?? ''
  const allowed = env.ALLOWED_ORIGIN ?? 'https://daegu-agent-crew.github.io'
  const localOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  const responseOrigin = origin === allowed || localOrigin ? origin : allowed
  return {
    'access-control-allow-origin': responseOrigin,
    'access-control-allow-headers': 'authorization, content-type, idempotency-key',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'vary': 'Origin',
  }
}

function json(request: Request, env: Env, body: JsonRecord, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(request, env) })
}

async function readBody(request: Request): Promise<JsonRecord | null> {
  try {
    const value = await request.json()
    return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
  } catch {
    return null
  }
}

function error(request: Request, env: Env, code: string, message: string, status: number) {
  return json(request, env, { success: false, code, error: message }, status)
}

async function authenticateAgent(request: Request, env: Env): Promise<AgentRow | Response> {
  const authorization = request.headers.get('authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!token) return error(request, env, 'AUTH_REQUIRED', '에이전트 세션이 필요합니다.', 401)
  const agent = await env.DB.prepare('SELECT id, name, role, wallet FROM agents WHERE session_token_hash = ? AND session_expires_at > ?')
    .bind(await sha256(token), new Date().toISOString()).first<AgentRow>()
  return agent ?? error(request, env, 'SESSION_EXPIRED', '에이전트 세션이 만료됐습니다. 지갑으로 다시 등록해 주세요.', 401)
}

function audit(env: Env, input: { agentId?: string | null; campaignId?: string | null; eventType: string; payload: JsonRecord; createdAt: string }) {
  return env.DB.prepare('INSERT INTO audit_events (id, agent_id, campaign_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), input.agentId ?? null, input.campaignId ?? null, input.eventType, JSON.stringify(input.payload), input.createdAt)
}

function parseAuditPayload(value: string): JsonRecord {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonRecord : {}
  } catch {
    return {}
  }
}

async function createChallenge(request: Request, env: Env) {
  const body = await readBody(request)
  const role = parseRole(body?.role)
  const wallet = typeof body?.wallet === 'string' ? body.wallet.trim() : ''
  if (!role || !decodePublicKey(wallet)) return json(request, env, { error: '역할 또는 Solana 지갑 주소가 올바르지 않습니다.' }, 400)

  let inviteId: string | null = null
  if (role === 'brand') {
    const inviteCode = typeof body?.inviteCode === 'string' ? body.inviteCode.trim() : ''
    if (!inviteCode) return json(request, env, { error: '브랜드 에이전트는 초대 코드가 필요합니다.' }, 403)
    const invite = await env.DB.prepare('SELECT id FROM brand_invites WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?')
      .bind(await sha256(inviteCode), new Date().toISOString()).first<{ id: string }>()
    if (!invite) return json(request, env, { error: '초대 코드가 유효하지 않거나 만료됐습니다.' }, 403)
    inviteId = invite.id
  }

  const challengeId = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString()
  const message = buildChallengeMessage({ id: challengeId, wallet, role, expiresAt })
  await env.DB.prepare('INSERT INTO auth_challenges (id, wallet, role, message, invite_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(challengeId, wallet, role, message, inviteId, expiresAt, new Date().toISOString()).run()
  return json(request, env, { challengeId, message, expiresAt }, 201)
}

async function registerAgent(request: Request, env: Env) {
  const body = await readBody(request)
  const challengeId = typeof body?.challengeId === 'string' ? body.challengeId : ''
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const signature = typeof body?.signature === 'string' ? body.signature.trim() : ''
  if (!challengeId || !isValidAgentName(name) || !signature) return json(request, env, { error: '등록 정보가 올바르지 않습니다.' }, 400)

  const challenge = await env.DB.prepare('SELECT id, wallet, role, message, invite_id, expires_at, used_at FROM auth_challenges WHERE id = ?')
    .bind(challengeId).first<{ id: string; wallet: string; role: 'brand' | 'creator'; message: string; invite_id: string | null; expires_at: string; used_at: string | null }>()
  if (!challenge || challenge.used_at || challenge.expires_at <= new Date().toISOString()) return json(request, env, { error: '서명 문구가 만료됐거나 이미 사용됐습니다.' }, 409)
  if (!verifyWalletSignature({ message: challenge.message, signature, wallet: challenge.wallet })) return json(request, env, { error: '지갑 서명을 확인할 수 없습니다.' }, 401)

  const agentId = `agt_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`
  const createdAt = new Date().toISOString()
  const sessionToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '')
  const sessionExpiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString()
  const statements = [
    env.DB.prepare('UPDATE auth_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL').bind(createdAt, challenge.id),
    env.DB.prepare('INSERT INTO agents (id, name, role, wallet, challenge_id, invite_id, session_token_hash, session_expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(agentId, name, challenge.role, challenge.wallet, challenge.id, challenge.invite_id, await sha256(sessionToken), sessionExpiresAt, createdAt),
    audit(env, { agentId, eventType: 'agent.registered', payload: { role: challenge.role, wallet: challenge.wallet }, createdAt }),
  ]
  if (challenge.invite_id) statements.push(env.DB.prepare('UPDATE brand_invites SET used_at = ?, used_by_agent_id = ? WHERE id = ? AND used_at IS NULL').bind(createdAt, agentId, challenge.invite_id))
  try {
    await env.DB.batch(statements)
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return json(request, env, { error: '이미 등록된 지갑이거나 사용된 브랜드 초대 코드입니다.' }, 409)
    }
    throw error
  }
  return json(request, env, { agentId, name, role: challenge.role, wallet: challenge.wallet, sessionToken, sessionExpiresAt, createdAt }, 201)
}

async function createLoginChallenge(request: Request, env: Env) {
  const body = await readBody(request)
  const role = parseRole(body?.role)
  const wallet = typeof body?.wallet === 'string' ? body.wallet.trim() : ''
  if (!role || !decodePublicKey(wallet)) return error(request, env, 'INVALID_LOGIN', '역할 또는 Solana 지갑 주소가 올바르지 않습니다.', 400)

  const agent = await env.DB.prepare('SELECT id, name, role, wallet FROM agents WHERE wallet = ? AND role = ?')
    .bind(wallet, role).first<AgentRow>()
  if (!agent) return error(request, env, 'AGENT_NOT_FOUND', '이 지갑과 역할로 등록된 에이전트를 찾을 수 없습니다.', 404)

  const challengeId = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString()
  const message = buildLoginChallengeMessage({ id: challengeId, agentId: agent.id, wallet, role, expiresAt })
  await env.DB.prepare('INSERT INTO login_challenges (id, agent_id, wallet, role, message, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(challengeId, agent.id, wallet, role, message, expiresAt, createdAt).run()
  return json(request, env, { challengeId, message, expiresAt, agentId: agent.id, name: agent.name, role: agent.role, wallet: agent.wallet }, 201)
}

async function loginAgent(request: Request, env: Env) {
  const body = await readBody(request)
  const challengeId = typeof body?.challengeId === 'string' ? body.challengeId : ''
  const signature = typeof body?.signature === 'string' ? body.signature.trim() : ''
  if (!challengeId || !signature) return error(request, env, 'INVALID_LOGIN', '로그인 정보가 올바르지 않습니다.', 400)

  const challenge = await env.DB.prepare(`SELECT c.id, c.agent_id, c.wallet, c.role, c.message, c.expires_at, c.used_at, a.name, a.created_at
    FROM login_challenges c JOIN agents a ON a.id = c.agent_id WHERE c.id = ?`)
    .bind(challengeId).first<{ id: string; agent_id: string; wallet: string; role: 'brand' | 'creator'; message: string; expires_at: string; used_at: string | null; name: string; created_at: string }>()
  if (!challenge || challenge.used_at || challenge.expires_at <= new Date().toISOString()) return error(request, env, 'CHALLENGE_EXPIRED', '로그인 서명 문구가 만료됐거나 이미 사용됐습니다.', 409)
  if (!verifyWalletSignature({ message: challenge.message, signature, wallet: challenge.wallet })) return error(request, env, 'INVALID_SIGNATURE', '지갑 서명을 확인할 수 없습니다.', 401)

  const loggedInAt = new Date().toISOString()
  const sessionToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '')
  const sessionExpiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString()
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO agent_sessions (id, agent_id, challenge_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), challenge.agent_id, challenge.id, await sha256(sessionToken), sessionExpiresAt, loggedInAt),
      env.DB.prepare('UPDATE login_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL').bind(loggedInAt, challenge.id),
      env.DB.prepare('UPDATE agents SET session_token_hash = ?, session_expires_at = ? WHERE id = ?')
        .bind(await sha256(sessionToken), sessionExpiresAt, challenge.agent_id),
      audit(env, { agentId: challenge.agent_id, eventType: 'agent.logged_in', payload: { role: challenge.role, wallet: challenge.wallet }, createdAt: loggedInAt }),
    ])
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('UNIQUE constraint failed')) return error(request, env, 'CHALLENGE_USED', '이미 사용된 로그인 서명 문구입니다.', 409)
    throw cause
  }
  return json(request, env, { agentId: challenge.agent_id, name: challenge.name, role: challenge.role, wallet: challenge.wallet, sessionToken, sessionExpiresAt, createdAt: challenge.created_at })
}

async function createCampaign(request: Request, env: Env) {
  const agent = await authenticateAgent(request, env)
  if (agent instanceof Response) return agent
  if (agent.role !== 'brand') return error(request, env, 'ROLE_FORBIDDEN', '브랜드 에이전트만 캠페인을 만들 수 있습니다.', 403)
  const body = await readBody(request)
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  if (title.length < 3 || title.length > 80 || /[<>]/.test(title)) return error(request, env, 'INVALID_CAMPAIGN', '캠페인 제목이 올바르지 않습니다.', 400)
  const campaignId = `cmp_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`
  const createdAt = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare('INSERT INTO campaigns (id, title, brand_agent_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(campaignId, title, agent.id, 'negotiating', createdAt, createdAt),
    audit(env, { agentId: agent.id, campaignId, eventType: 'campaign.created', payload: { title }, createdAt }),
  ])
  return json(request, env, { campaignId, title, status: 'negotiating', brandAgentId: agent.id, createdAt }, 201)
}

async function listCampaigns(request: Request, env: Env) {
  const rows = await env.DB.prepare('SELECT id, title, brand_agent_id, creator_agent_id, status, accepted_offer_id, created_at, updated_at FROM campaigns ORDER BY created_at DESC LIMIT 50').all<CampaignRow>()
  return json(request, env, { campaigns: rows.results })
}

async function listAgents(request: Request, env: Env) {
  const rows = await env.DB.prepare('SELECT id, name, role, wallet, created_at FROM agents ORDER BY created_at DESC LIMIT 100').all<AgentRow & { created_at: string }>()
  return json(request, env, { agents: rows.results.map((agent) => ({ agentId: agent.id, name: agent.name, role: agent.role, wallet: agent.wallet, createdAt: agent.created_at })) })
}

async function listAuditEvents(request: Request, env: Env) {
  const rows = await env.DB.prepare(`SELECT e.id, e.agent_id, a.name AS agent_name, a.role AS agent_role, e.campaign_id, c.title AS campaign_title, e.event_type, e.payload, e.created_at
    FROM audit_events e
    LEFT JOIN agents a ON a.id = e.agent_id
    LEFT JOIN campaigns c ON c.id = e.campaign_id
    ORDER BY e.created_at DESC LIMIT 100`).all<{
      id: string
      agent_id: string | null
      agent_name: string | null
      agent_role: 'brand' | 'creator' | null
      campaign_id: string | null
      campaign_title: string | null
      event_type: string
      payload: string
      created_at: string
    }>()
  return json(request, env, { events: rows.results.map((event) => ({
    eventId: event.id,
    agentId: event.agent_id,
    agentName: event.agent_name,
    agentRole: event.agent_role,
    campaignId: event.campaign_id,
    campaignTitle: event.campaign_title,
    eventType: event.event_type,
    payload: parseAuditPayload(event.payload),
    createdAt: event.created_at,
  })) })
}

async function getCampaign(request: Request, env: Env, campaignId: string) {
  const campaign = await env.DB.prepare('SELECT id, title, brand_agent_id, creator_agent_id, status, accepted_offer_id, created_at, updated_at FROM campaigns WHERE id = ?').bind(campaignId).first<CampaignRow>()
  if (!campaign) return error(request, env, 'NOT_FOUND', '캠페인을 찾을 수 없습니다.', 404)
  const offers = await env.DB.prepare('SELECT id, campaign_id, agent_id, kind, deliverable, deadline, deposit_usdc, balance_usdc, bonus_usdc, kpi_type, kpi_threshold, status, created_at, decided_at FROM offers WHERE campaign_id = ? ORDER BY created_at').bind(campaignId).all()
  return json(request, env, { campaign, offers: offers.results })
}

async function createOffer(request: Request, env: Env, campaignId: string) {
  const agent = await authenticateAgent(request, env)
  if (agent instanceof Response) return agent
  const body = await readBody(request)
  const kind = parseOfferKind(body?.kind)
  const terms = validateOfferTerms(body)
  if (!kind || !terms) return error(request, env, 'POLICY_BLOCKED', '오퍼 조건이 올바르지 않거나 총액이 0.10 USDC를 넘습니다.', 422)
  const campaign = await env.DB.prepare('SELECT id, brand_agent_id, creator_agent_id, status FROM campaigns WHERE id = ?').bind(campaignId).first<Pick<CampaignRow, 'id' | 'brand_agent_id' | 'creator_agent_id' | 'status'>>()
  if (!campaign) return error(request, env, 'NOT_FOUND', '캠페인을 찾을 수 없습니다.', 404)
  if (campaign.status !== 'negotiating') return error(request, env, 'STATE_CONFLICT', '협상이 끝난 캠페인입니다.', 409)
  if (agent.role === 'brand' && campaign.brand_agent_id !== agent.id) return error(request, env, 'ROLE_FORBIDDEN', '이 캠페인의 브랜드 에이전트가 아닙니다.', 403)
  if (agent.role === 'creator' && campaign.creator_agent_id && campaign.creator_agent_id !== agent.id) return error(request, env, 'ROLE_FORBIDDEN', '다른 크리에이터가 이미 협상 중입니다.', 403)
  const offerId = `off_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`
  const createdAt = new Date().toISOString()
  const statements = [
    env.DB.prepare("UPDATE offers SET status = 'superseded', decided_at = ? WHERE campaign_id = ? AND status = 'pending'").bind(createdAt, campaignId),
    env.DB.prepare('INSERT INTO offers (id, campaign_id, agent_id, kind, deliverable, deadline, deposit_usdc, balance_usdc, bonus_usdc, kpi_type, kpi_threshold, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(offerId, campaignId, agent.id, kind, terms.deliverable, terms.deadline, terms.depositUsdc, terms.balanceUsdc, terms.bonusUsdc, 'youtube_views', terms.kpiThreshold, 'pending', createdAt),
    audit(env, { agentId: agent.id, campaignId, eventType: `offer.${kind === 'counter' ? 'countered' : 'created'}`, payload: { offerId, ...terms }, createdAt }),
  ]
  if (agent.role === 'creator' && !campaign.creator_agent_id) statements.push(env.DB.prepare('UPDATE campaigns SET creator_agent_id = ?, updated_at = ? WHERE id = ? AND creator_agent_id IS NULL').bind(agent.id, createdAt, campaignId))
  await env.DB.batch(statements)
  return json(request, env, { offerId, campaignId, agentId: agent.id, kind, status: 'pending', ...terms, createdAt }, 201)
}

async function decideOffer(request: Request, env: Env, offerId: string, decision: 'accept' | 'reject') {
  const agent = await authenticateAgent(request, env)
  if (agent instanceof Response) return agent
  const offer = await env.DB.prepare(`SELECT o.id, o.campaign_id, o.agent_id, o.status, c.brand_agent_id, c.creator_agent_id, c.status AS campaign_status, a.role AS offer_role FROM offers o JOIN campaigns c ON c.id = o.campaign_id JOIN agents a ON a.id = o.agent_id WHERE o.id = ?`)
    .bind(offerId).first<{ id: string; campaign_id: string; agent_id: string; status: string; brand_agent_id: string; creator_agent_id: string | null; campaign_status: string; offer_role: 'brand' | 'creator' }>()
  if (!offer) return error(request, env, 'NOT_FOUND', '오퍼를 찾을 수 없습니다.', 404)
  if (offer.status !== 'pending' || offer.campaign_status !== 'negotiating') return error(request, env, 'STATE_CONFLICT', '이미 처리됐거나 종료된 오퍼입니다.', 409)
  if (agent.role === offer.offer_role) return error(request, env, 'ROLE_FORBIDDEN', '자신의 오퍼는 직접 결정할 수 없습니다.', 403)
  if (agent.role === 'brand' && offer.brand_agent_id !== agent.id) return error(request, env, 'ROLE_FORBIDDEN', '이 캠페인의 브랜드 에이전트가 아닙니다.', 403)
  if (agent.role === 'creator' && offer.creator_agent_id && offer.creator_agent_id !== agent.id) return error(request, env, 'ROLE_FORBIDDEN', '이 캠페인의 크리에이터 에이전트가 아닙니다.', 403)
  const decidedAt = new Date().toISOString()
  if (decision === 'reject') {
    await env.DB.batch([
      env.DB.prepare("UPDATE offers SET status = 'rejected', decided_at = ? WHERE id = ? AND status = 'pending'").bind(decidedAt, offerId),
      audit(env, { agentId: agent.id, campaignId: offer.campaign_id, eventType: 'offer.rejected', payload: { offerId }, createdAt: decidedAt }),
    ])
    return json(request, env, { offerId, status: 'rejected', decidedAt })
  }
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO deal_acceptances (campaign_id, offer_id, accepted_by_agent_id, accepted_at) VALUES (?, ?, ?, ?)').bind(offer.campaign_id, offerId, agent.id, decidedAt),
      env.DB.prepare("UPDATE offers SET status = 'accepted', decided_at = ? WHERE id = ? AND status = 'pending'").bind(decidedAt, offerId),
      env.DB.prepare("UPDATE campaigns SET status = 'accepted', accepted_offer_id = ?, creator_agent_id = COALESCE(creator_agent_id, ?), updated_at = ? WHERE id = ? AND status = 'negotiating'").bind(offerId, agent.role === 'creator' ? agent.id : offer.agent_id, decidedAt, offer.campaign_id),
      audit(env, { agentId: agent.id, campaignId: offer.campaign_id, eventType: 'deal.accepted', payload: { offerId }, createdAt: decidedAt }),
    ])
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('UNIQUE constraint failed')) return error(request, env, 'STATE_CONFLICT', '다른 오퍼가 먼저 수락됐습니다.', 409)
    throw cause
  }
  return json(request, env, { offerId, campaignId: offer.campaign_id, status: 'accepted', decidedAt })
}

async function getAudit(request: Request, env: Env, campaignId: string) {
  const events = await env.DB.prepare('SELECT id, agent_id, event_type, payload, created_at FROM audit_events WHERE campaign_id = ? ORDER BY created_at, id').bind(campaignId).all()
  return json(request, env, { campaignId, events: events.results })
}

async function verifyPublicYoutubeVideo(videoId: string) {
  const youtubeUrl = canonicalYoutubeUrl(videoId)
  const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`, {
    headers: { accept: 'application/json' },
  })
  if (!response.ok) return null
  const payload = await response.json() as { title?: unknown; author_name?: unknown; thumbnail_url?: unknown }
  const title = typeof payload.title === 'string' ? payload.title.trim() : ''
  const channelTitle = typeof payload.author_name === 'string' ? payload.author_name.trim() : ''
  if (!title || !channelTitle) return null
  return {
    youtubeUrl,
    title: title.slice(0, 200),
    channelTitle: channelTitle.slice(0, 200),
    thumbnailUrl: typeof payload.thumbnail_url === 'string' ? payload.thumbnail_url : null,
  }
}

function creatorOfferV2Json(row: CreatorOfferV2Row) {
  return {
    offerId: row.id,
    campaignId: row.campaign_id,
    campaignTitle: row.campaign_title,
    creatorName: row.creator_name,
    youtubeChannel: row.youtube_channel,
    creatorWallet: row.creator_wallet,
    fitScore: row.fit_score,
    amountBaseUnits: row.amount_base_units,
    amountUsdc: row.amount_usdc,
    aiRationale: row.ai_rationale,
    status: row.status,
    video: row.video_id ? { videoId: row.video_id, youtubeUrl: row.youtube_url, title: row.video_title, channelTitle: row.verified_channel_title, thumbnailUrl: row.thumbnail_url } : null,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    submittedAt: row.submitted_at,
    verifiedAt: row.verified_at,
    paidAt: row.paid_at,
    updatedAt: row.updated_at,
  }
}

async function findCreatorOfferV2ByToken(env: Env, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null
  return env.DB.prepare(`SELECT o.*, c.title AS campaign_title FROM creatorflow2_offers o JOIN campaigns c ON c.id = o.campaign_id WHERE o.access_token_hash = ?`)
    .bind(await sha256(token)).first<CreatorOfferV2Row>()
}

async function createCreatorOfferV2(request: Request, env: Env) {
  const agent = await authenticateAgent(request, env)
  if (agent instanceof Response) return agent
  if (agent.role !== 'brand') return error(request, env, 'ROLE_FORBIDDEN', '브랜드 AI만 크리에이터에게 제안할 수 있습니다.', 403)
  const body = await readBody(request)
  const campaignId = typeof body?.campaignId === 'string' ? body.campaignId : ''
  const creatorName = typeof body?.creatorName === 'string' ? body.creatorName.trim() : ''
  const youtubeChannel = typeof body?.youtubeChannel === 'string' ? body.youtubeChannel.trim() : ''
  const creatorWallet = typeof body?.creatorWallet === 'string' && body.creatorWallet.trim() ? body.creatorWallet.trim() : null
  const fitScore = Number.isInteger(body?.fitScore) ? Number(body?.fitScore) : -1
  const aiRationale = typeof body?.aiRationale === 'string' ? body.aiRationale.trim().slice(0, 240) : ''
  if (!/^[^<>]{2,60}$/u.test(creatorName) || !/^[^<>]{2,120}$/u.test(youtubeChannel) || (creatorWallet && !decodePublicKey(creatorWallet))) return error(request, env, 'INVALID_CREATOR', '크리에이터 이름, 채널 또는 지갑이 올바르지 않습니다.', 400)
  const payout = recommendCreatorPayout(fitScore)
  if (!payout) return error(request, env, 'INVALID_FIT_SCORE', 'AI 적합도는 0~100 정수여야 합니다.', 400)
  const campaign = await env.DB.prepare('SELECT id, title, brand_agent_id FROM campaigns WHERE id = ?').bind(campaignId).first<{ id: string; title: string; brand_agent_id: string }>()
  if (!campaign) return error(request, env, 'CAMPAIGN_NOT_FOUND', '캠페인을 찾을 수 없습니다.', 404)
  if (campaign.brand_agent_id !== agent.id) return error(request, env, 'ROLE_FORBIDDEN', '이 캠페인의 브랜드 AI가 아닙니다.', 403)
  const offerId = `cfo_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`
  const inviteToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '')
  const createdAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60_000).toISOString()
  const rationale = aiRationale || `YouTube 채널 적합도 ${fitScore}점 · 시스템 지급 구간 ${payout.tier}`
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO creatorflow2_offers (id, campaign_id, brand_agent_id, creator_name, youtube_channel, creator_wallet, fit_score, amount_base_units, amount_usdc, ai_rationale, access_token_hash, status, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?)`)
      .bind(offerId, campaign.id, agent.id, creatorName, youtubeChannel, creatorWallet, payout.fitScore, payout.amountBaseUnits, payout.amountUsdc, rationale, await sha256(inviteToken), expiresAt, createdAt, createdAt),
    audit(env, { agentId: agent.id, campaignId: campaign.id, eventType: 'creatorflow2.offer_proposed', payload: { offerId, creatorName, youtubeChannel, fitScore, amountUsdc: payout.amountUsdc, rationale }, createdAt }),
  ])
  return json(request, env, { offer: creatorOfferV2Json({ id: offerId, campaign_id: campaign.id, campaign_title: campaign.title, brand_agent_id: agent.id, creator_name: creatorName, youtube_channel: youtubeChannel, creator_wallet: creatorWallet, fit_score: payout.fitScore, amount_base_units: payout.amountBaseUnits, amount_usdc: payout.amountUsdc, ai_rationale: rationale, status: 'proposed', video_id: null, youtube_url: null, video_title: null, verified_channel_title: null, thumbnail_url: null, creator_signature: null, expires_at: expiresAt, accepted_at: null, submitted_at: null, verified_at: null, paid_at: null, created_at: createdAt, updated_at: createdAt }), inviteToken }, 201)
}

async function getCreatorInviteV2(request: Request, env: Env, token: string) {
  const offer = await findCreatorOfferV2ByToken(env, token)
  if (!offer) return error(request, env, 'INVITE_NOT_FOUND', '제안 링크가 올바르지 않습니다.', 404)
  if (offer.status === 'proposed' && offer.expires_at <= new Date().toISOString()) {
    await env.DB.prepare("UPDATE creatorflow2_offers SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'proposed'").bind(new Date().toISOString(), offer.id).run()
    offer.status = 'expired'
  }
  return json(request, env, { offer: creatorOfferV2Json(offer) })
}

async function createCreatorInviteChallengeV2(request: Request, env: Env, token: string) {
  const offer = await findCreatorOfferV2ByToken(env, token)
  if (!offer) return error(request, env, 'INVITE_NOT_FOUND', '제안 링크가 올바르지 않습니다.', 404)
  const body = await readBody(request)
  const action = body?.action === 'accept' || body?.action === 'submit' ? body.action : null
  const wallet = typeof body?.wallet === 'string' ? body.wallet.trim() : ''
  if (!action || !decodePublicKey(wallet)) return error(request, env, 'INVALID_ACTION', '행동 또는 크리에이터 지갑이 올바르지 않습니다.', 400)
  if (offer.creator_wallet && offer.creator_wallet !== wallet) return error(request, env, 'WALLET_MISMATCH', '제안에 지정된 크리에이터 지갑과 다릅니다.', 403)
  if (action === 'accept' && offer.status !== 'proposed') return error(request, env, 'STATE_CONFLICT', '현재 수락할 수 없는 제안입니다.', 409)
  if (action === 'submit' && offer.status !== 'accepted') return error(request, env, 'STATE_CONFLICT', '제안을 먼저 수락해야 합니다.', 409)

  let verified: Awaited<ReturnType<typeof verifyPublicYoutubeVideo>> = null
  let videoId: string | null = null
  if (action === 'submit') {
    videoId = getYoutubeVideoId(body?.youtubeUrl)
    if (!videoId) return error(request, env, 'INVALID_YOUTUBE_URL', '올바른 YouTube 영상 주소를 입력해 주세요.', 400)
    verified = await verifyPublicYoutubeVideo(videoId)
    if (!verified) return error(request, env, 'YOUTUBE_NOT_PUBLIC', 'YouTube에서 공개 영상을 확인할 수 없습니다.', 422)
    if (verified.channelTitle.trim().toLocaleLowerCase() !== offer.youtube_channel.trim().toLocaleLowerCase()) return error(request, env, 'YOUTUBE_CHANNEL_MISMATCH', `제안 채널(${offer.youtube_channel})과 영상 채널(${verified.channelTitle})이 다릅니다.`, 422)
  }
  const challengeId = crypto.randomUUID()
  const confirmationCode = challengeId.replaceAll('-', '').slice(0, 8).toUpperCase()
  const createdAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString()
  const message = buildCreatorOfferActionMessage({ action, offerId: offer.id, campaignId: offer.campaign_id, wallet, amountUsdc: offer.amount_usdc, videoId: videoId ?? undefined, confirmationCode })
  await env.DB.prepare(`INSERT INTO creatorflow2_challenges (id, offer_id, action, wallet, message, video_id, youtube_url, video_title, verified_channel_title, thumbnail_url, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(challengeId, offer.id, action, wallet, message, videoId, verified?.youtubeUrl ?? null, verified?.title ?? null, verified?.channelTitle ?? null, verified?.thumbnailUrl ?? null, expiresAt, createdAt).run()
  return json(request, env, { challengeId, action, message, expiresAt, video: verified && videoId ? { videoId, ...verified } : null }, 201)
}

async function completeCreatorInviteActionV2(request: Request, env: Env, token: string) {
  const offer = await findCreatorOfferV2ByToken(env, token)
  if (!offer) return error(request, env, 'INVITE_NOT_FOUND', '제안 링크가 올바르지 않습니다.', 404)
  const body = await readBody(request)
  const challengeId = typeof body?.challengeId === 'string' ? body.challengeId : ''
  const signature = typeof body?.signature === 'string' ? body.signature.trim() : ''
  const challenge = await env.DB.prepare('SELECT * FROM creatorflow2_challenges WHERE id = ? AND offer_id = ?').bind(challengeId, offer.id).first<{
    id: string; offer_id: string; action: 'accept' | 'submit'; wallet: string; message: string; video_id: string | null; youtube_url: string | null; video_title: string | null; verified_channel_title: string | null; thumbnail_url: string | null; expires_at: string; used_at: string | null
  }>()
  if (!challenge || !signature) return error(request, env, 'CHALLENGE_NOT_FOUND', '서명 요청을 찾을 수 없습니다.', 404)
  if (challenge.used_at || challenge.expires_at <= new Date().toISOString()) return error(request, env, 'CHALLENGE_EXPIRED', '서명 요청이 만료됐거나 이미 사용됐습니다.', 409)
  if (!verifyWalletSignature({ message: challenge.message, signature, wallet: challenge.wallet })) return error(request, env, 'INVALID_SIGNATURE', '크리에이터 지갑 서명을 확인할 수 없습니다.', 401)
  const completedAt = new Date().toISOString()
  if (challenge.action === 'accept') {
    if (offer.status !== 'proposed') return error(request, env, 'STATE_CONFLICT', '이미 처리된 제안입니다.', 409)
    await env.DB.batch([
      env.DB.prepare("UPDATE creatorflow2_offers SET status = 'accepted', creator_wallet = ?, accepted_at = ?, updated_at = ? WHERE id = ? AND status = 'proposed'").bind(challenge.wallet, completedAt, completedAt, offer.id),
      env.DB.prepare('UPDATE creatorflow2_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL').bind(completedAt, challenge.id),
      audit(env, { campaignId: offer.campaign_id, eventType: 'creatorflow2.offer_accepted', payload: { offerId: offer.id, creatorWallet: challenge.wallet }, createdAt: completedAt }),
    ])
    return json(request, env, { offer: creatorOfferV2Json({ ...offer, status: 'accepted', creator_wallet: challenge.wallet, accepted_at: completedAt, updated_at: completedAt }) })
  }
  if (offer.status !== 'accepted' || !challenge.video_id || !challenge.youtube_url || !challenge.video_title || !challenge.verified_channel_title) return error(request, env, 'STATE_CONFLICT', '현재 영상을 제출할 수 없습니다.', 409)
  const [legacyDuplicate, v2Duplicate] = await Promise.all([
    env.DB.prepare('SELECT id FROM video_submissions WHERE video_id = ?').bind(challenge.video_id).first(),
    env.DB.prepare('SELECT id FROM creatorflow2_offers WHERE video_id = ? AND id != ?').bind(challenge.video_id, offer.id).first(),
  ])
  if (legacyDuplicate || v2Duplicate) return error(request, env, 'VIDEO_ALREADY_USED', '이 YouTube 영상은 이미 다른 제안에 제출됐습니다.', 409)
  await env.DB.batch([
    env.DB.prepare(`UPDATE creatorflow2_offers SET status = 'verified', video_id = ?, youtube_url = ?, video_title = ?, verified_channel_title = ?, thumbnail_url = ?, creator_signature = ?, submitted_at = ?, verified_at = ?, updated_at = ? WHERE id = ? AND status = 'accepted'`)
      .bind(challenge.video_id, challenge.youtube_url, challenge.video_title, challenge.verified_channel_title, challenge.thumbnail_url, signature, completedAt, completedAt, completedAt, offer.id),
    env.DB.prepare('UPDATE creatorflow2_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL').bind(completedAt, challenge.id),
    audit(env, { campaignId: offer.campaign_id, eventType: 'creatorflow2.video_verified', payload: { offerId: offer.id, videoId: challenge.video_id, channelTitle: challenge.verified_channel_title, creatorWallet: challenge.wallet }, createdAt: completedAt }),
  ])
  return json(request, env, { offer: creatorOfferV2Json({ ...offer, status: 'verified', video_id: challenge.video_id, youtube_url: challenge.youtube_url, video_title: challenge.video_title, verified_channel_title: challenge.verified_channel_title, thumbnail_url: challenge.thumbnail_url, creator_signature: signature, submitted_at: completedAt, verified_at: completedAt, updated_at: completedAt }) })
}

async function listVideoSubmissions(request: Request, env: Env) {
  const rows = await env.DB.prepare(`SELECT v.id, v.campaign_id, c.title AS campaign_title, v.creator_agent_id, a.name AS creator_name,
    v.video_id, v.youtube_url, v.title, v.channel_title, v.thumbnail_url, v.verification_status, v.creator_signature IS NOT NULL AS creator_signed, v.created_at, v.verified_at
    FROM video_submissions v JOIN campaigns c ON c.id = v.campaign_id JOIN agents a ON a.id = v.creator_agent_id
    ORDER BY v.created_at DESC LIMIT 20`).all<VideoSubmissionRow>()
  return json(request, env, { videos: rows.results.map((video) => ({
    submissionId: video.id,
    campaignId: video.campaign_id,
    campaignTitle: video.campaign_title,
    creatorAgentId: video.creator_agent_id,
    creatorName: video.creator_name,
    videoId: video.video_id,
    youtubeUrl: video.youtube_url,
    title: video.title,
    channelTitle: video.channel_title,
    thumbnailUrl: video.thumbnail_url,
    verificationStatus: video.verification_status,
    creatorSigned: Boolean(video.creator_signed),
    createdAt: video.created_at,
    verifiedAt: video.verified_at,
  })) })
}

async function createVideoSubmissionChallenge(request: Request, env: Env) {
  const agent = await authenticateAgent(request, env)
  if (agent instanceof Response) return agent
  if (agent.role !== 'creator') return error(request, env, 'ROLE_FORBIDDEN', '크리에이터 에이전트로 로그인해야 영상을 등록할 수 있습니다.', 403)
  const body = await readBody(request)
  const videoId = getYoutubeVideoId(body?.youtubeUrl)
  if (!videoId) return error(request, env, 'INVALID_YOUTUBE_URL', '올바른 YouTube 영상 주소를 입력해 주세요.', 400)

  const campaign = await env.DB.prepare(`SELECT id, title FROM campaigns WHERE creator_agent_id = ? AND status IN ('negotiating', 'accepted') ORDER BY created_at DESC LIMIT 1`)
    .bind(agent.id).first<{ id: string; title: string }>()
  if (!campaign) return error(request, env, 'CAMPAIGN_NOT_FOUND', '이 크리에이터가 참여 중인 캠페인을 찾을 수 없습니다.', 409)
  const verified = await verifyPublicYoutubeVideo(videoId)
  if (!verified) return error(request, env, 'YOUTUBE_NOT_PUBLIC', 'YouTube에서 공개 영상을 확인할 수 없습니다. 비공개 상태인지 확인해 주세요.', 422)

  const challengeId = crypto.randomUUID()
  const confirmationCode = challengeId.replaceAll('-', '').slice(0, 8).toUpperCase()
  const createdAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString()
  const message = buildVideoSubmissionMessage({ videoId, confirmationCode })
  await env.DB.prepare(`INSERT INTO video_submission_challenges (id, agent_id, campaign_id, video_id, message, youtube_url, title, channel_title, thumbnail_url, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(challengeId, agent.id, campaign.id, videoId, message, verified.youtubeUrl, verified.title, verified.channelTitle, verified.thumbnailUrl, expiresAt, createdAt).run()
  return json(request, env, { challengeId, message, expiresAt, videoId, title: verified.title, channelTitle: verified.channelTitle, thumbnailUrl: verified.thumbnailUrl }, 201)
}

async function createVideoAttestationChallenge(request: Request, env: Env, submissionId: string) {
  const agent = await authenticateAgent(request, env)
  if (agent instanceof Response) return agent
  if (agent.role !== 'creator') return error(request, env, 'ROLE_FORBIDDEN', '크리에이터 에이전트로 로그인해야 영상을 확인 서명할 수 있습니다.', 403)
  const submission = await env.DB.prepare(`SELECT v.id, v.campaign_id, v.video_id, v.youtube_url, v.title, v.channel_title, v.thumbnail_url, v.creator_signature
    FROM video_submissions v WHERE v.id = ? AND v.creator_agent_id = ?`).bind(submissionId, agent.id).first<{
      id: string; campaign_id: string; video_id: string; youtube_url: string; title: string; channel_title: string; thumbnail_url: string | null; creator_signature: string | null
    }>()
  if (!submission) return error(request, env, 'VIDEO_NOT_FOUND', '이 크리에이터의 등록 영상을 찾을 수 없습니다.', 404)
  if (submission.creator_signature) return error(request, env, 'ALREADY_SIGNED', '이미 대구루 지갑으로 제출 확인된 영상입니다.', 409)

  const challengeId = crypto.randomUUID()
  const confirmationCode = challengeId.replaceAll('-', '').slice(0, 8).toUpperCase()
  const createdAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString()
  const message = buildVideoSubmissionMessage({ videoId: submission.video_id, confirmationCode })
  await env.DB.prepare(`INSERT INTO video_submission_challenges (id, agent_id, campaign_id, video_id, message, youtube_url, title, channel_title, thumbnail_url, submission_id, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(challengeId, agent.id, submission.campaign_id, submission.video_id, message, submission.youtube_url, submission.title, submission.channel_title, submission.thumbnail_url, submission.id, expiresAt, createdAt).run()
  return json(request, env, { challengeId, message, expiresAt, videoId: submission.video_id, title: submission.title, channelTitle: submission.channel_title, thumbnailUrl: submission.thumbnail_url }, 201)
}

async function submitSignedVideo(request: Request, env: Env) {
  const agent = await authenticateAgent(request, env)
  if (agent instanceof Response) return agent
  if (agent.role !== 'creator') return error(request, env, 'ROLE_FORBIDDEN', '크리에이터 에이전트로 로그인해야 영상을 제출할 수 있습니다.', 403)
  const body = await readBody(request)
  const challengeId = typeof body?.challengeId === 'string' ? body.challengeId : ''
  const signature = typeof body?.signature === 'string' ? body.signature.trim() : ''
  if (!challengeId || !signature) return error(request, env, 'INVALID_SUBMISSION', '영상 제출 서명 정보가 올바르지 않습니다.', 400)

  const challenge = await env.DB.prepare(`SELECT v.id, v.agent_id, v.campaign_id, c.title AS campaign_title, v.video_id, v.message, v.youtube_url, v.title, v.channel_title, v.thumbnail_url, v.submission_id, v.expires_at, v.used_at
    FROM video_submission_challenges v JOIN campaigns c ON c.id = v.campaign_id WHERE v.id = ?`).bind(challengeId).first<{
      id: string; agent_id: string; campaign_id: string; campaign_title: string; video_id: string; message: string; youtube_url: string; title: string; channel_title: string; thumbnail_url: string | null; submission_id: string | null; expires_at: string; used_at: string | null
    }>()
  if (!challenge || challenge.agent_id !== agent.id) return error(request, env, 'CHALLENGE_NOT_FOUND', '영상 제출 서명 문구를 찾을 수 없습니다.', 404)
  if (challenge.used_at || challenge.expires_at <= new Date().toISOString()) return error(request, env, 'CHALLENGE_EXPIRED', '영상 제출 서명 문구가 만료됐거나 이미 사용됐습니다.', 409)
  if (!verifyWalletSignature({ message: challenge.message, signature, wallet: agent.wallet })) return error(request, env, 'INVALID_SIGNATURE', '크리에이터 지갑 서명을 확인할 수 없습니다.', 401)

  const submissionId = `vid_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`
  const createdAt = new Date().toISOString()
  if (challenge.submission_id) {
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO video_attestations (submission_id, challenge_id, agent_id, signature, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(challenge.submission_id, challenge.id, agent.id, signature, createdAt),
        env.DB.prepare('UPDATE video_submissions SET submission_challenge_id = ?, creator_signature = ? WHERE id = ? AND creator_signature IS NULL')
          .bind(challenge.id, signature, challenge.submission_id),
        env.DB.prepare('UPDATE video_submission_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL').bind(createdAt, challenge.id),
        audit(env, { agentId: agent.id, campaignId: challenge.campaign_id, eventType: 'youtube.video_attested', payload: { submissionId: challenge.submission_id, videoId: challenge.video_id, creatorSigned: true }, createdAt }),
      ])
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes('UNIQUE constraint failed')) return error(request, env, 'ALREADY_SIGNED', '이미 대구루 지갑으로 제출 확인된 영상입니다.', 409)
      throw cause
    }
    return json(request, env, {
      submissionId: challenge.submission_id, campaignId: challenge.campaign_id, campaignTitle: challenge.campaign_title,
      creatorAgentId: agent.id, creatorName: agent.name, videoId: challenge.video_id, youtubeUrl: challenge.youtube_url,
      title: challenge.title, channelTitle: challenge.channel_title, thumbnailUrl: challenge.thumbnail_url,
      verificationStatus: 'public_verified', creatorSigned: true, createdAt, verifiedAt: createdAt,
    })
  }
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO video_submissions (id, campaign_id, creator_agent_id, video_id, youtube_url, title, channel_title, thumbnail_url, verification_status, created_at, verified_at, submission_challenge_id, creator_signature)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'public_verified', ?, ?, ?, ?)`)
        .bind(submissionId, challenge.campaign_id, agent.id, challenge.video_id, challenge.youtube_url, challenge.title, challenge.channel_title, challenge.thumbnail_url, createdAt, createdAt, challenge.id, signature),
      env.DB.prepare('UPDATE video_submission_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL').bind(createdAt, challenge.id),
      audit(env, { agentId: agent.id, campaignId: challenge.campaign_id, eventType: 'youtube.video_registered', payload: { submissionId, videoId: challenge.video_id, title: challenge.title, channelTitle: challenge.channel_title, verificationStatus: 'public_verified', creatorSigned: true }, createdAt }),
    ])
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('UNIQUE constraint failed')) return error(request, env, 'VIDEO_ALREADY_REGISTERED', '이 캠페인 또는 영상은 이미 등록되어 있습니다.', 409)
    throw cause
  }
  return json(request, env, {
    submissionId,
    campaignId: challenge.campaign_id,
    campaignTitle: challenge.campaign_title,
    creatorAgentId: agent.id,
    creatorName: agent.name,
    videoId: challenge.video_id,
    youtubeUrl: challenge.youtube_url,
    title: challenge.title,
    channelTitle: challenge.channel_title,
    thumbnailUrl: challenge.thumbnail_url,
    verificationStatus: 'public_verified',
    creatorSigned: true,
    createdAt,
    verifiedAt: createdAt,
  }, 201)
}

function paymentJson(row: PaymentRow) {
  return {
    paymentId: row.id,
    campaignId: row.campaign_id,
    campaignTitle: row.campaign_title,
    milestone: row.milestone,
    senderWallet: row.sender_wallet,
    authorityWallet: row.authority_wallet ?? row.sender_wallet,
    recipientWallet: row.recipient_wallet,
    mint: row.mint,
    amountBaseUnits: row.amount_base_units,
    amountUsdc: row.amount_usdc,
    memo: row.memo,
    status: row.status,
    transactionSignature: row.transaction_signature,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
  }
}

async function listPayments(request: Request, env: Env) {
  const rows = await env.DB.prepare(`SELECT p.id, p.campaign_id, c.title AS campaign_title, p.milestone, p.sender_wallet, p.authority_wallet, p.recipient_wallet,
    p.mint, p.amount_base_units, p.amount_usdc, p.memo, p.status, p.transaction_signature, p.created_at, p.confirmed_at
    FROM payment_requests p JOIN campaigns c ON c.id = p.campaign_id ORDER BY p.created_at DESC LIMIT 50`).all<PaymentRow>()
  return json(request, env, { payments: rows.results.map(paymentJson) })
}

function delegationJson(row: DelegationRow) {
  return {
    delegationId: row.id, brandAgentId: row.brand_agent_id, campaignId: row.campaign_id, ownerWallet: row.owner_wallet, delegateWallet: row.delegate_wallet,
    tokenAccount: row.token_account, mint: row.mint, allowanceBaseUnits: row.allowance_base_units,
    allowanceUsdc: (Number(row.allowance_base_units) / 1_000_000).toFixed(2), status: row.status,
    approvalSignature: row.approval_signature, createdAt: row.created_at, revokedAt: row.revoked_at, revocationSignature: row.revocation_signature,
  }
}

async function getDelegation(request: Request, env: Env) {
  const agent = await authenticateAgent(request, env)
  if (agent instanceof Response) return agent
  if (agent.role !== 'brand') return error(request, env, 'ROLE_FORBIDDEN', '브랜드 AI만 위임 상태를 확인할 수 있습니다.', 403)
  const campaignId = new URL(request.url).searchParams.get('campaignId')
  const row = campaignId
    ? await env.DB.prepare('SELECT * FROM brand_wallet_delegations WHERE brand_agent_id = ? AND campaign_id = ? ORDER BY created_at DESC LIMIT 1').bind(agent.id, campaignId).first<DelegationRow>()
    : await env.DB.prepare('SELECT * FROM brand_wallet_delegations WHERE brand_agent_id = ? ORDER BY created_at DESC LIMIT 1').bind(agent.id).first<DelegationRow>()
  return json(request, env, { delegation: row ? delegationJson(row) : null })
}

async function confirmDelegation(request: Request, env: Env) {
  const agent = await authenticateAgent(request, env)
  if (agent instanceof Response) return agent
  if (agent.role !== 'brand') return error(request, env, 'ROLE_FORBIDDEN', '브랜드 AI만 지갑 위임을 연결할 수 있습니다.', 403)
  const body = await readBody(request)
  const ownerWallet = typeof body?.ownerWallet === 'string' ? body.ownerWallet.trim() : ''
  const campaignId = typeof body?.campaignId === 'string' ? body.campaignId : ''
  const transactionSignature = typeof body?.transactionSignature === 'string' ? body.transactionSignature.trim() : ''
  const allowanceBaseUnits = typeof body?.allowanceBaseUnits === 'string' ? body.allowanceBaseUnits : '100000'
  if (!decodePublicKey(ownerWallet) || !/^\d+$/.test(allowanceBaseUnits) || BigInt(allowanceBaseUnits) < 1n || BigInt(allowanceBaseUnits) > 300000n) return error(request, env, 'INVALID_DELEGATION', '소유자 지갑 또는 위임 한도가 올바르지 않습니다.', 400)
  const campaign = await env.DB.prepare('SELECT c.id, c.brand_agent_id, a.wallet AS current_brand_wallet FROM campaigns c JOIN agents a ON a.id = c.brand_agent_id WHERE c.id = ?').bind(campaignId).first<{ id: string; brand_agent_id: string; current_brand_wallet: string }>()
  if (!campaign) return error(request, env, 'CAMPAIGN_NOT_FOUND', '캠페인을 찾을 수 없습니다.', 404)
  const previous = await env.DB.prepare("SELECT * FROM brand_wallet_delegations WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 1").bind(campaignId).first<DelegationRow>()
  const canTakeOver = campaign.brand_agent_id === agent.id || campaign.current_brand_wallet === ownerWallet || (previous?.status === 'revoked' && previous.owner_wallet === ownerWallet)
  if (!canTakeOver) return error(request, env, 'CAMPAIGN_OWNERSHIP_REQUIRED', '브랜드 사람 지갑의 기존 소유권 또는 revoke 기록을 확인할 수 없습니다.', 403)
  const active = await env.DB.prepare("SELECT id FROM brand_wallet_delegations WHERE brand_agent_id = ? AND status = 'active'").bind(agent.id).first()
  if (active) return error(request, env, 'ACTIVE_DELEGATION_EXISTS', '기존 캠페인의 AI 지갑 위임을 먼저 해제해 주세요.', 409)
  const transaction = await fetchDevnetTransaction(transactionSignature, env.SOLANA_RPC_URL)
  const verified = verifyDevnetUsdcDelegation(transaction, { ownerWallet, delegateWallet: agent.wallet, mint: SOLANA_DEVNET_USDC_MINT, allowanceBaseUnits })
  if (!verified) return error(request, env, 'DELEGATION_VERIFICATION_FAILED', 'Devnet USDC 위임 거래를 확인할 수 없습니다.', 422)
  const createdAt = new Date().toISOString()
  const id = `dlg_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO brand_wallet_delegations (id, brand_agent_id, campaign_id, owner_wallet, delegate_wallet, token_account, mint, allowance_base_units, approval_signature, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`).bind(id, agent.id, campaignId, ownerWallet, agent.wallet, verified.tokenAccount, SOLANA_DEVNET_USDC_MINT, allowanceBaseUnits, transactionSignature, createdAt),
    audit(env, { agentId: agent.id, campaignId, eventType: 'wallet.delegation_confirmed', payload: { delegationId: id, ownerWallet, delegateWallet: agent.wallet, allowanceBaseUnits, transactionSignature }, createdAt }),
    ...(campaign.brand_agent_id !== agent.id ? [env.DB.prepare('UPDATE campaigns SET brand_agent_id = ?, updated_at = ? WHERE id = ?').bind(agent.id, createdAt, campaignId)] : []),
  ])
  return json(request, env, { delegation: delegationJson({ id, brand_agent_id: agent.id, campaign_id: campaignId, owner_wallet: ownerWallet, delegate_wallet: agent.wallet, token_account: verified.tokenAccount, mint: SOLANA_DEVNET_USDC_MINT, allowance_base_units: allowanceBaseUnits, approval_signature: transactionSignature, status: 'active', created_at: createdAt, revoked_at: null, revocation_signature: null }) }, 201)
}

async function confirmDelegationRevocation(request: Request, env: Env) {
  const body = await readBody(request)
  const transactionSignature = typeof body?.transactionSignature === 'string' ? body.transactionSignature.trim() : ''
  const delegationId = typeof body?.delegationId === 'string' ? body.delegationId : ''
  const row = await env.DB.prepare("SELECT * FROM brand_wallet_delegations WHERE id = ? AND status = 'active'").bind(delegationId).first<DelegationRow>()
  if (!row) return error(request, env, 'DELEGATION_NOT_FOUND', '활성 위임이 없습니다.', 404)
  const transaction = await fetchDevnetTransaction(transactionSignature, env.SOLANA_RPC_URL)
  if (!verifyDevnetUsdcRevocation(transaction, { ownerWallet: row.owner_wallet, tokenAccount: row.token_account })) return error(request, env, 'REVOCATION_VERIFICATION_FAILED', 'Devnet 위임 해제 거래를 확인할 수 없습니다.', 422)
  const revokedAt = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare("UPDATE brand_wallet_delegations SET status = 'revoked', revoked_at = ?, revocation_signature = ? WHERE id = ? AND status = 'active'").bind(revokedAt, transactionSignature, row.id),
    audit(env, { agentId: row.brand_agent_id, campaignId: row.campaign_id, eventType: 'wallet.delegation_revoked', payload: { delegationId: row.id, transactionSignature, recoveryReady: true }, createdAt: revokedAt }),
  ])
  return json(request, env, { delegation: delegationJson({ ...row, status: 'revoked', revoked_at: revokedAt, revocation_signature: transactionSignature }) })
}

async function findDelegationRecovery(request: Request, env: Env) {
  const body = await readBody(request)
  const ownerWallet = typeof body?.ownerWallet === 'string' ? body.ownerWallet.trim() : ''
  const campaignId = typeof body?.campaignId === 'string' ? body.campaignId : ''
  if (!decodePublicKey(ownerWallet) || !campaignId) return error(request, env, 'INVALID_RECOVERY', '브랜드 사람 지갑과 캠페인이 필요합니다.', 400)
  const row = await env.DB.prepare("SELECT * FROM brand_wallet_delegations WHERE owner_wallet = ? AND campaign_id = ? AND status = 'active'").bind(ownerWallet, campaignId).first<DelegationRow>()
  if (!row) return error(request, env, 'DELEGATION_NOT_FOUND', '이 캠페인의 활성 AI 권한이 없습니다.', 404)
  return json(request, env, { delegation: delegationJson(row) })
}

async function listCreatorFlow2Pipeline(request: Request, env: Env) {
  const v2Rows = await env.DB.prepare(`SELECT o.*, c.title AS campaign_title, p.transaction_signature
    FROM creatorflow2_offers o JOIN campaigns c ON c.id = o.campaign_id
    LEFT JOIN creatorflow2_payments p ON p.offer_id = o.id
    WHERE o.status NOT IN ('rejected', 'expired') ORDER BY o.updated_at DESC`).all<CreatorOfferV2Row & { transaction_signature: string | null }>()
  const rows = await env.DB.prepare(`SELECT a.id AS creator_id, a.name AS creator_name, a.wallet AS creator_wallet,
    c.id AS campaign_id, c.title AS campaign_title, c.status AS campaign_status,
    o.balance_usdc AS offered_amount, v.video_id, v.youtube_url, v.channel_title, v.title AS video_title,
    v.verification_status, v.creator_signature IS NOT NULL AS creator_signed,
    p.status AS payment_status, p.transaction_signature,
    COALESCE(p.confirmed_at, p.created_at, v.verified_at, c.updated_at, a.created_at) AS updated_at
    FROM agents a
    LEFT JOIN campaigns c ON c.id = (SELECT c2.id FROM campaigns c2 WHERE c2.creator_agent_id = a.id ORDER BY c2.updated_at DESC LIMIT 1)
    LEFT JOIN offers o ON o.id = c.accepted_offer_id
    LEFT JOIN video_submissions v ON v.id = (SELECT v2.id FROM video_submissions v2 WHERE v2.campaign_id = c.id ORDER BY v2.verified_at DESC LIMIT 1)
    LEFT JOIN payment_requests p ON p.campaign_id = c.id AND p.milestone = 'video_publication'
    WHERE a.role = 'creator' ORDER BY updated_at DESC`).all<PipelineRow>()

  const v2Creators = v2Rows.results.map((row) => {
    const stage = row.status === 'paid' ? 'paid' : row.status === 'verified' ? 'verified' : row.status === 'submitted' ? 'submitted' : row.status === 'accepted' ? 'accepted' : 'proposed'
    return {
      creatorId: row.id,
      creatorName: row.creator_name,
      creatorWallet: row.creator_wallet ?? '',
      youtubeChannel: row.verified_channel_title ?? row.youtube_channel,
      campaignId: row.campaign_id,
      campaignTitle: row.campaign_title,
      offeredAmountUsdc: row.amount_usdc,
      fitScore: row.fit_score,
      stage,
      nextAction: stage === 'proposed' ? '수락 대기' : stage === 'accepted' ? '영상 제출 대기' : stage === 'submitted' ? '시스템 검증 중' : stage === 'verified' ? 'AI 지급 서명 대기' : '지급 완료',
      video: row.video_id ? { videoId: row.video_id, youtubeUrl: row.youtube_url, title: row.video_title, verificationStatus: row.verified_at ? 'public_verified' : 'submitted', creatorSigned: Boolean(row.creator_signature) } : null,
      transactionSignature: row.transaction_signature,
      updatedAt: row.updated_at,
    }
  })
  const legacyCreators = rows.results.map((row, index) => {
    const fitScore = row.video_id ? 86 : Math.max(55, 76 - index * 7)
    const recommendation = recommendCreatorPayout(fitScore)!
    const stage = row.payment_status === 'confirmed' ? 'paid'
      : row.payment_status === 'requested' || (row.video_id && row.verification_status && Boolean(row.creator_signed)) ? 'verified'
      : row.video_id ? 'submitted'
      : row.campaign_status === 'accepted' ? 'accepted'
      : 'proposed'
    return {
      creatorId: row.creator_id,
      creatorName: row.creator_name,
      creatorWallet: row.creator_wallet,
      youtubeChannel: row.channel_title ?? 'YouTube 채널 연결 전',
      campaignId: row.campaign_id,
      campaignTitle: row.campaign_title,
      offeredAmountUsdc: row.offered_amount ?? recommendation.amountUsdc,
      fitScore,
      stage,
      nextAction: stage === 'proposed' ? '수락 대기' : stage === 'accepted' ? '영상 제출 대기' : stage === 'submitted' ? '시스템 검증 중' : stage === 'verified' ? 'AI 지급 서명 대기' : '지급 완료',
      video: row.video_id ? { videoId: row.video_id, youtubeUrl: row.youtube_url, title: row.video_title, verificationStatus: row.verification_status, creatorSigned: Boolean(row.creator_signed) } : null,
      transactionSignature: row.transaction_signature,
      updatedAt: row.updated_at,
    }
  })
  return json(request, env, {
    campaign: { id: v2Rows.results[0]?.campaign_id ?? rows.results[0]?.campaign_id ?? null, title: v2Rows.results[0]?.campaign_title ?? rows.results[0]?.campaign_title ?? 'CreatorFlow 소개 영상', network: 'Solana Devnet', campaignCapUsdc: '0.30', dailyAiCapUsdc: '0.10' },
    creators: [...v2Creators, ...legacyCreators],
  })
}

function creatorPaymentV2Json(row: CreatorPaymentV2Row) {
  return {
    paymentId: row.id, offerId: row.offer_id, campaignId: row.campaign_id,
    senderWallet: row.sender_wallet, authorityWallet: row.authority_wallet, recipientWallet: row.recipient_wallet,
    mint: row.mint, amountBaseUnits: row.amount_base_units, amountUsdc: row.amount_usdc, memo: row.memo,
    status: row.status, transactionSignature: row.transaction_signature, createdAt: row.created_at, confirmedAt: row.confirmed_at,
  }
}

async function prepareCreatorPaymentV2(request: Request, env: Env, offerId: string) {
  const agent = await authenticateAgent(request, env)
  if (agent instanceof Response) return agent
  if (agent.role !== 'brand') return error(request, env, 'ROLE_FORBIDDEN', '브랜드 AI만 지급을 준비할 수 있습니다.', 403)
  const offer = await env.DB.prepare(`SELECT o.*, c.title AS campaign_title FROM creatorflow2_offers o JOIN campaigns c ON c.id = o.campaign_id WHERE o.id = ?`).bind(offerId).first<CreatorOfferV2Row>()
  if (!offer) return error(request, env, 'OFFER_NOT_FOUND', '크리에이터 제안을 찾을 수 없습니다.', 404)
  if (offer.brand_agent_id !== agent.id) return error(request, env, 'ROLE_FORBIDDEN', '이 제안의 브랜드 AI가 아닙니다.', 403)
  if (offer.status !== 'verified' || !offer.creator_wallet || !offer.creator_signature) return error(request, env, 'PAYMENT_NOT_READY', '크리에이터의 수락·영상 제출·검증이 모두 필요합니다.', 409)
  const existing = await env.DB.prepare('SELECT * FROM creatorflow2_payments WHERE offer_id = ?').bind(offer.id).first<CreatorPaymentV2Row>()
  if (existing) return json(request, env, { payment: creatorPaymentV2Json(existing) })
  const delegation = await env.DB.prepare("SELECT * FROM brand_wallet_delegations WHERE brand_agent_id = ? AND campaign_id = ? AND status = 'active'").bind(agent.id, offer.campaign_id).first<DelegationRow>()
  if (!delegation) return error(request, env, 'DELEGATION_REQUIRED', '이 캠페인의 AI 지갑 지급 한도를 먼저 연결해 주세요.', 409)
  if (BigInt(delegation.allowance_base_units) < BigInt(offer.amount_base_units)) return error(request, env, 'DELEGATION_TOO_SMALL', '남은 제안 금액보다 위임 한도가 작습니다.', 409)

  const today = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`
  const [campaignV2, campaignLegacy, dailyV2, dailyLegacy] = await Promise.all([
    env.DB.prepare("SELECT amount_base_units FROM creatorflow2_payments WHERE campaign_id = ? AND status IN ('prepared', 'confirmed')").bind(offer.campaign_id).all<{ amount_base_units: string }>(),
    env.DB.prepare("SELECT amount_base_units FROM payment_requests WHERE campaign_id = ? AND status IN ('requested', 'confirmed')").bind(offer.campaign_id).all<{ amount_base_units: string }>(),
    env.DB.prepare("SELECT amount_base_units FROM creatorflow2_payments WHERE authority_wallet = ? AND created_at >= ? AND status IN ('prepared', 'confirmed')").bind(agent.wallet, today).all<{ amount_base_units: string }>(),
    env.DB.prepare("SELECT amount_base_units FROM payment_requests WHERE authority_wallet = ? AND created_at >= ? AND status IN ('requested', 'confirmed')").bind(agent.wallet, today).all<{ amount_base_units: string }>(),
  ])
  const sum = (values: Array<{ amount_base_units: string }>) => values.reduce((total, item) => total + BigInt(item.amount_base_units), 0n)
  const campaignSpent = sum([...campaignV2.results, ...campaignLegacy.results]).toString()
  const dailySpent = sum([...dailyV2.results, ...dailyLegacy.results]).toString()
  if (!isPayoutWithinLimits({ amountBaseUnits: offer.amount_base_units, campaignSpentBaseUnits: campaignSpent, dailySpentBaseUnits: dailySpent })) return error(request, env, 'PAYMENT_LIMIT_EXCEEDED', '캠페인 또는 AI 일일 지급 한도를 초과합니다.', 409)

  const paymentId = `cfp_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`
  const memo = `CreatorFlow2:${paymentId}`
  const createdAt = new Date().toISOString()
  const row: CreatorPaymentV2Row = { id: paymentId, offer_id: offer.id, campaign_id: offer.campaign_id, brand_agent_id: agent.id, sender_wallet: delegation.owner_wallet, authority_wallet: agent.wallet, recipient_wallet: offer.creator_wallet, mint: SOLANA_DEVNET_USDC_MINT, amount_base_units: offer.amount_base_units, amount_usdc: offer.amount_usdc, memo, status: 'prepared', transaction_signature: null, created_at: createdAt, confirmed_at: null }
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO creatorflow2_payments (id, offer_id, campaign_id, brand_agent_id, sender_wallet, authority_wallet, recipient_wallet, mint, amount_base_units, amount_usdc, memo, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?)`)
      .bind(row.id, row.offer_id, row.campaign_id, row.brand_agent_id, row.sender_wallet, row.authority_wallet, row.recipient_wallet, row.mint, row.amount_base_units, row.amount_usdc, row.memo, row.created_at),
    audit(env, { agentId: agent.id, campaignId: offer.campaign_id, eventType: 'creatorflow2.payment_prepared', payload: { paymentId, offerId: offer.id, recipientWallet: offer.creator_wallet, amountUsdc: offer.amount_usdc, authorityWallet: agent.wallet }, createdAt }),
  ])
  return json(request, env, { payment: creatorPaymentV2Json(row) }, 201)
}

async function confirmCreatorPaymentV2(request: Request, env: Env, paymentId: string, suppliedSignature?: string) {
  const agent = await authenticateAgent(request, env)
  if (agent instanceof Response) return agent
  if (agent.role !== 'brand') return error(request, env, 'ROLE_FORBIDDEN', '브랜드 AI만 지급을 확인할 수 있습니다.', 403)
  const body = suppliedSignature ? null : await readBody(request)
  const transactionSignature = suppliedSignature ?? (typeof body?.transactionSignature === 'string' ? body.transactionSignature.trim() : '')
  const payment = await env.DB.prepare('SELECT * FROM creatorflow2_payments WHERE id = ?').bind(paymentId).first<CreatorPaymentV2Row>()
  if (!payment) return error(request, env, 'PAYMENT_NOT_FOUND', '지급 준비 기록을 찾을 수 없습니다.', 404)
  if (payment.brand_agent_id !== agent.id || payment.authority_wallet !== agent.wallet) return error(request, env, 'ROLE_FORBIDDEN', '이 지급을 서명한 브랜드 AI가 아닙니다.', 403)
  if (payment.status === 'confirmed') {
    if (payment.transaction_signature !== transactionSignature) return error(request, env, 'PAYMENT_ALREADY_CONFIRMED', '이미 다른 거래로 지급됐습니다.', 409)
    return json(request, env, { payment: creatorPaymentV2Json(payment) })
  }
  const [legacyUse, otherV2Use] = await Promise.all([
    env.DB.prepare('SELECT id FROM payment_requests WHERE transaction_signature = ?').bind(transactionSignature).first(),
    env.DB.prepare('SELECT id FROM creatorflow2_payments WHERE transaction_signature = ? AND id != ?').bind(transactionSignature, payment.id).first(),
  ])
  if (legacyUse || otherV2Use) return error(request, env, 'TRANSACTION_ALREADY_USED', '이미 다른 지급에 사용된 Solana 거래입니다.', 409)
  let transaction: unknown = null
  for (let attempt = 0; attempt < 5 && !transaction; attempt += 1) {
    transaction = await fetchDevnetTransaction(transactionSignature, env.SOLANA_RPC_URL)
    if (!transaction) await new Promise((resolve) => setTimeout(resolve, 450))
  }
  if (!verifyDevnetUsdcPayment(transaction, { senderWallet: payment.sender_wallet, authorityWallet: payment.authority_wallet, recipientWallet: payment.recipient_wallet, mint: payment.mint, amountBaseUnits: payment.amount_base_units, memo: payment.memo })) return error(request, env, 'PAYMENT_VERIFICATION_FAILED', '수신자·금액·위임 서명·메모가 정확한 Devnet USDC 거래를 확인할 수 없습니다.', 422)
  const confirmedAt = new Date().toISOString()
  try {
    await env.DB.batch([
      env.DB.prepare("UPDATE creatorflow2_payments SET status = 'confirmed', transaction_signature = ?, confirmed_at = ? WHERE id = ? AND status = 'prepared'").bind(transactionSignature, confirmedAt, payment.id),
      env.DB.prepare("UPDATE creatorflow2_offers SET status = 'paid', paid_at = ?, updated_at = ? WHERE id = ? AND status = 'verified'").bind(confirmedAt, confirmedAt, payment.offer_id),
      audit(env, { agentId: agent.id, campaignId: payment.campaign_id, eventType: 'creatorflow2.payment_confirmed', payload: { paymentId: payment.id, offerId: payment.offer_id, amountUsdc: payment.amount_usdc, transactionSignature }, createdAt: confirmedAt }),
    ])
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('UNIQUE constraint failed')) return error(request, env, 'TRANSACTION_ALREADY_USED', '이미 다른 지급에 사용된 Solana 거래입니다.', 409)
    throw cause
  }
  return json(request, env, { payment: creatorPaymentV2Json({ ...payment, status: 'confirmed', transaction_signature: transactionSignature, confirmed_at: confirmedAt }) })
}

async function broadcastCreatorPaymentV2(request: Request, env: Env, paymentId: string) {
  const agent = await authenticateAgent(request, env)
  if (agent instanceof Response) return agent
  if (agent.role !== 'brand') return error(request, env, 'ROLE_FORBIDDEN', '브랜드 AI만 서명 거래를 전송할 수 있습니다.', 403)
  const body = await readBody(request)
  const signedTransactionBase64 = typeof body?.signedTransactionBase64 === 'string' ? body.signedTransactionBase64.trim() : ''
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signedTransactionBase64) || signedTransactionBase64.length > 5000) return error(request, env, 'INVALID_SIGNED_TRANSACTION', '서명된 Solana 거래 형식이 올바르지 않습니다.', 400)
  const payment = await env.DB.prepare('SELECT * FROM creatorflow2_payments WHERE id = ?').bind(paymentId).first<CreatorPaymentV2Row>()
  if (!payment || payment.brand_agent_id !== agent.id || payment.authority_wallet !== agent.wallet) return error(request, env, 'PAYMENT_NOT_FOUND', '이 브랜드 AI의 지급 준비 기록을 찾을 수 없습니다.', 404)
  const rpcUrl = env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
  const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: [signedTransactionBase64, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed' }] }) })
  const rpc = await response.json() as { result?: unknown; error?: { message?: unknown } }
  if (!response.ok || typeof rpc.result !== 'string') return error(request, env, 'SOLANA_BROADCAST_FAILED', typeof rpc.error?.message === 'string' ? rpc.error.message : 'Solana Devnet 전송에 실패했습니다.', 422)
  return confirmCreatorPaymentV2(request, env, paymentId, rpc.result)
}

async function createPaymentRequest(request: Request, env: Env) {
  const agent = await authenticateAgent(request, env)
  if (agent instanceof Response) return agent
  if (agent.role !== 'brand') return error(request, env, 'ROLE_FORBIDDEN', '브랜드 에이전트만 USDC 지급을 요청할 수 있습니다.', 403)
  const body = await readBody(request)
  const campaignId = typeof body?.campaignId === 'string' ? body.campaignId : ''
  if (!campaignId) return error(request, env, 'INVALID_CAMPAIGN', '지급할 캠페인을 선택해 주세요.', 400)
  const campaign = await env.DB.prepare(`SELECT c.id, c.title, c.brand_agent_id, c.creator_agent_id, c.accepted_offer_id,
    brand.wallet AS sender_wallet, creator.wallet AS recipient_wallet, v.creator_signature
    FROM campaigns c JOIN agents brand ON brand.id = c.brand_agent_id JOIN agents creator ON creator.id = c.creator_agent_id
    JOIN video_submissions v ON v.campaign_id = c.id
    WHERE c.id = ? AND c.status = 'accepted'`).bind(campaignId).first<{
      id: string; title: string; brand_agent_id: string; creator_agent_id: string; accepted_offer_id: string; sender_wallet: string; recipient_wallet: string; creator_signature: string | null
    }>()
  if (!campaign) return error(request, env, 'PAYMENT_NOT_READY', '합의와 영상 등록이 완료된 캠페인을 찾을 수 없습니다.', 409)
  if (campaign.brand_agent_id !== agent.id) return error(request, env, 'ROLE_FORBIDDEN', '이 캠페인의 브랜드 에이전트가 아닙니다.', 403)
  if (!campaign.creator_signature) return error(request, env, 'CREATOR_SIGNATURE_REQUIRED', '대구루의 영상 제출 확인 서명이 먼저 필요합니다.', 409)

  const delegation = await env.DB.prepare("SELECT * FROM brand_wallet_delegations WHERE brand_agent_id = ? AND campaign_id = ? AND status = 'active'").bind(agent.id, campaign.id).first<DelegationRow>()
  const senderWallet = delegation?.owner_wallet ?? campaign.sender_wallet
  const authorityWallet = delegation?.delegate_wallet ?? campaign.sender_wallet

  const existing = await env.DB.prepare(`SELECT p.id, p.campaign_id, c.title AS campaign_title, p.milestone, p.sender_wallet, p.authority_wallet, p.recipient_wallet,
    p.mint, p.amount_base_units, p.amount_usdc, p.memo, p.status, p.transaction_signature, p.created_at, p.confirmed_at
    FROM payment_requests p JOIN campaigns c ON c.id = p.campaign_id WHERE p.campaign_id = ? AND p.milestone = 'video_publication'`)
    .bind(campaign.id).first<PaymentRow>()
  if (existing) return json(request, env, paymentJson(existing))

  const today = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`
  const campaignPayments = await env.DB.prepare("SELECT amount_base_units FROM payment_requests WHERE campaign_id = ? AND status IN ('requested', 'confirmed')").bind(campaign.id).all<{ amount_base_units: string }>()
  const dailyPayments = await env.DB.prepare("SELECT amount_base_units FROM payment_requests WHERE authority_wallet = ? AND created_at >= ? AND status IN ('requested', 'confirmed')").bind(authorityWallet, today).all<{ amount_base_units: string }>()
  const sum = (values: Array<{ amount_base_units: string }>) => values.reduce((total, item) => total + BigInt(item.amount_base_units), 0n).toString()
  if (!isPayoutWithinLimits({ amountBaseUnits: VIDEO_PAYMENT_AMOUNT_BASE_UNITS, campaignSpentBaseUnits: sum(campaignPayments.results), dailySpentBaseUnits: sum(dailyPayments.results) })) return error(request, env, 'PAYMENT_LIMIT_EXCEEDED', '캠페인 또는 AI 일일 지급 한도를 초과합니다.', 409)

  const paymentId = `pay_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`
  const memo = `CreatorFlow:${paymentId}`
  const createdAt = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO payment_requests (id, campaign_id, offer_id, milestone, from_agent_id, to_agent_id, sender_wallet, authority_wallet, recipient_wallet, mint, amount_base_units, amount_usdc, memo, status, created_at)
      VALUES (?, ?, ?, 'video_publication', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?)`)
      .bind(paymentId, campaign.id, campaign.accepted_offer_id, agent.id, campaign.creator_agent_id, senderWallet, authorityWallet, campaign.recipient_wallet, SOLANA_DEVNET_USDC_MINT, VIDEO_PAYMENT_AMOUNT_BASE_UNITS, VIDEO_PAYMENT_AMOUNT_USDC, memo, createdAt),
    audit(env, { agentId: agent.id, campaignId: campaign.id, eventType: 'payment.requested', payload: { paymentId, milestone: 'video_publication', amountUsdc: VIDEO_PAYMENT_AMOUNT_USDC, recipientWallet: campaign.recipient_wallet, mint: SOLANA_DEVNET_USDC_MINT }, createdAt }),
  ])
  return json(request, env, paymentJson({
    id: paymentId, campaign_id: campaign.id, campaign_title: campaign.title, milestone: 'video_publication', sender_wallet: senderWallet, authority_wallet: authorityWallet,
    recipient_wallet: campaign.recipient_wallet, mint: SOLANA_DEVNET_USDC_MINT, amount_base_units: VIDEO_PAYMENT_AMOUNT_BASE_UNITS,
    amount_usdc: VIDEO_PAYMENT_AMOUNT_USDC, memo, status: 'requested', transaction_signature: null, created_at: createdAt, confirmed_at: null,
  }), 201)
}

async function confirmPayment(request: Request, env: Env, paymentId: string) {
  const agent = await authenticateAgent(request, env)
  if (agent instanceof Response) return agent
  if (agent.role !== 'brand') return error(request, env, 'ROLE_FORBIDDEN', '브랜드 에이전트만 지급 거래를 확인할 수 있습니다.', 403)
  const body = await readBody(request)
  const transactionSignature = typeof body?.transactionSignature === 'string' ? body.transactionSignature.trim() : ''
  if (!transactionSignature) return error(request, env, 'INVALID_TRANSACTION', 'Solana 거래 서명이 필요합니다.', 400)
  const payment = await env.DB.prepare(`SELECT p.id, p.campaign_id, c.title AS campaign_title, p.milestone, p.from_agent_id, p.sender_wallet, p.authority_wallet, p.recipient_wallet,
    p.mint, p.amount_base_units, p.amount_usdc, p.memo, p.status, p.transaction_signature, p.created_at, p.confirmed_at
    FROM payment_requests p JOIN campaigns c ON c.id = p.campaign_id WHERE p.id = ?`).bind(paymentId).first<PaymentRow & { from_agent_id: string }>()
  if (!payment) return error(request, env, 'PAYMENT_NOT_FOUND', '지급 요청을 찾을 수 없습니다.', 404)
  if (payment.from_agent_id !== agent.id) return error(request, env, 'ROLE_FORBIDDEN', '이 지급 요청의 브랜드 에이전트가 아닙니다.', 403)
  if (payment.status === 'confirmed') {
    if (payment.transaction_signature !== transactionSignature) return error(request, env, 'PAYMENT_ALREADY_CONFIRMED', '이미 다른 거래로 지급 확인됐습니다.', 409)
    return json(request, env, paymentJson(payment))
  }
  const v2Use = await env.DB.prepare('SELECT id FROM creatorflow2_payments WHERE transaction_signature = ?').bind(transactionSignature).first()
  if (v2Use) return error(request, env, 'TRANSACTION_ALREADY_USED', '이미 CreatorFlow2 지급에 사용된 Solana 거래입니다.', 409)
  const transaction = await fetchDevnetTransaction(transactionSignature, env.SOLANA_RPC_URL)
  const valid = verifyDevnetUsdcPayment(transaction, {
    senderWallet: payment.sender_wallet,
    authorityWallet: payment.authority_wallet ?? payment.sender_wallet,
    recipientWallet: payment.recipient_wallet,
    mint: payment.mint,
    amountBaseUnits: payment.amount_base_units,
    memo: payment.memo,
  })
  if (!valid) return error(request, env, 'PAYMENT_VERIFICATION_FAILED', '0.03 Devnet USDC 지급 거래를 확인할 수 없습니다.', 422)

  const confirmedAt = new Date().toISOString()
  try {
    await env.DB.batch([
      env.DB.prepare("UPDATE payment_requests SET status = 'confirmed', transaction_signature = ?, confirmed_at = ? WHERE id = ? AND status = 'requested'")
        .bind(transactionSignature, confirmedAt, payment.id),
      audit(env, { agentId: agent.id, campaignId: payment.campaign_id, eventType: 'payment.confirmed', payload: { paymentId: payment.id, milestone: payment.milestone, amountUsdc: payment.amount_usdc, transactionSignature, mint: payment.mint }, createdAt: confirmedAt }),
    ])
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('UNIQUE constraint failed')) return error(request, env, 'TRANSACTION_ALREADY_USED', '이미 다른 지급에 사용된 Solana 거래입니다.', 409)
    throw cause
  }
  return json(request, env, paymentJson({ ...payment, status: 'confirmed', transaction_signature: transactionSignature, confirmed_at: confirmedAt }))
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) })
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/api/health') return json(request, env, { ok: true, service: 'creatorflow-api' })
    if (request.method === 'POST' && url.pathname === '/api/auth/challenge') return createChallenge(request, env)
    if (request.method === 'POST' && url.pathname === '/api/auth/login-challenge') return createLoginChallenge(request, env)
    if (request.method === 'POST' && url.pathname === '/api/agents/register') return registerAgent(request, env)
    if (request.method === 'POST' && url.pathname === '/api/agents/login') return loginAgent(request, env)
    if (request.method === 'GET' && url.pathname === '/api/agents') return listAgents(request, env)
    if (request.method === 'GET' && url.pathname === '/api/audit') return listAuditEvents(request, env)
    if (request.method === 'GET' && url.pathname === '/api/videos') return listVideoSubmissions(request, env)
    if (request.method === 'POST' && url.pathname === '/api/videos/challenge') return createVideoSubmissionChallenge(request, env)
    if (request.method === 'POST' && url.pathname === '/api/videos/submit') return submitSignedVideo(request, env)
    const videoAttestationMatch = url.pathname.match(/^\/api\/videos\/([^/]+)\/attestation-challenge$/)
    if (request.method === 'POST' && videoAttestationMatch) return createVideoAttestationChallenge(request, env, videoAttestationMatch[1])
    if (request.method === 'GET' && url.pathname === '/api/payments') return listPayments(request, env)
    if (request.method === 'GET' && url.pathname === '/api/delegations/current') return getDelegation(request, env)
    if (request.method === 'POST' && url.pathname === '/api/delegations/confirm') return confirmDelegation(request, env)
    if (request.method === 'POST' && url.pathname === '/api/delegations/recovery') return findDelegationRecovery(request, env)
    if (request.method === 'POST' && url.pathname === '/api/delegations/revoke/confirm') return confirmDelegationRevocation(request, env)
    if (request.method === 'GET' && url.pathname === '/api/creatorflow2/pipeline') return listCreatorFlow2Pipeline(request, env)
    if (request.method === 'POST' && url.pathname === '/api/creatorflow2/offers') return createCreatorOfferV2(request, env)
    const creatorInviteMatch = url.pathname.match(/^\/api\/creatorflow2\/invites\/([a-f0-9]{64})$/)
    if (request.method === 'GET' && creatorInviteMatch) return getCreatorInviteV2(request, env, creatorInviteMatch[1])
    const creatorInviteChallengeMatch = url.pathname.match(/^\/api\/creatorflow2\/invites\/([a-f0-9]{64})\/challenge$/)
    if (request.method === 'POST' && creatorInviteChallengeMatch) return createCreatorInviteChallengeV2(request, env, creatorInviteChallengeMatch[1])
    const creatorInviteCompleteMatch = url.pathname.match(/^\/api\/creatorflow2\/invites\/([a-f0-9]{64})\/complete$/)
    if (request.method === 'POST' && creatorInviteCompleteMatch) return completeCreatorInviteActionV2(request, env, creatorInviteCompleteMatch[1])
    const creatorOfferPaymentMatch = url.pathname.match(/^\/api\/creatorflow2\/offers\/([^/]+)\/payment$/)
    if (request.method === 'POST' && creatorOfferPaymentMatch) return prepareCreatorPaymentV2(request, env, creatorOfferPaymentMatch[1])
    const creatorPaymentConfirmMatch = url.pathname.match(/^\/api\/creatorflow2\/payments\/([^/]+)\/confirm$/)
    if (request.method === 'POST' && creatorPaymentConfirmMatch) return confirmCreatorPaymentV2(request, env, creatorPaymentConfirmMatch[1])
    const creatorPaymentBroadcastMatch = url.pathname.match(/^\/api\/creatorflow2\/payments\/([^/]+)\/broadcast$/)
    if (request.method === 'POST' && creatorPaymentBroadcastMatch) return broadcastCreatorPaymentV2(request, env, creatorPaymentBroadcastMatch[1])
    if (request.method === 'POST' && url.pathname === '/api/payments/request') return createPaymentRequest(request, env)
    const paymentConfirmMatch = url.pathname.match(/^\/api\/payments\/([^/]+)\/confirm$/)
    if (request.method === 'POST' && paymentConfirmMatch) return confirmPayment(request, env, paymentConfirmMatch[1])
    if (request.method === 'GET' && url.pathname === '/api/campaigns') return listCampaigns(request, env)
    if (request.method === 'POST' && url.pathname === '/api/campaigns') return createCampaign(request, env)
    const campaignMatch = url.pathname.match(/^\/api\/campaigns\/([^/]+)$/)
    if (request.method === 'GET' && campaignMatch) return getCampaign(request, env, campaignMatch[1])
    const offerMatch = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/offers$/)
    if (request.method === 'POST' && offerMatch) return createOffer(request, env, offerMatch[1])
    const decisionMatch = url.pathname.match(/^\/api\/offers\/([^/]+)\/(accept|reject)$/)
    if (request.method === 'POST' && decisionMatch) return decideOffer(request, env, decisionMatch[1], decisionMatch[2] as 'accept' | 'reject')
    const auditMatch = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/audit$/)
    if (request.method === 'GET' && auditMatch) return getAudit(request, env, auditMatch[1])
    return json(request, env, { error: '요청한 API를 찾을 수 없습니다.' }, 404)
  },
}
