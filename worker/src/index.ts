import { buildChallengeMessage, buildLoginChallengeMessage, decodePublicKey, isValidAgentName, parseRole, sha256, verifyWalletSignature } from './security'
import { parseOfferKind, validateOfferTerms } from './negotiation'
import { canonicalYoutubeUrl, getYoutubeVideoId } from './youtube'

interface Env {
  DB: D1Database
  ALLOWED_ORIGIN?: string
}

type JsonRecord = Record<string, unknown>
type AgentRow = { id: string; name: string; role: 'brand' | 'creator'; wallet: string }
type CampaignRow = { id: string; title: string; brand_agent_id: string; creator_agent_id: string | null; status: 'negotiating' | 'accepted' | 'cancelled'; accepted_offer_id: string | null; created_at: string; updated_at: string }
type VideoSubmissionRow = { id: string; campaign_id: string; campaign_title: string; creator_agent_id: string; creator_name: string; video_id: string; youtube_url: string; title: string; channel_title: string; thumbnail_url: string | null; verification_status: 'public_verified' | 'channel_verified'; created_at: string; verified_at: string }

function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get('origin') ?? ''
  const allowed = env.ALLOWED_ORIGIN ?? 'https://daegu-agent-crew.github.io'
  const workerHost = new URL(request.url).hostname
  const localWorker = workerHost === 'localhost' || workerHost === '127.0.0.1'
  const localOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  const responseOrigin = origin === allowed || (localWorker && localOrigin) ? origin : allowed
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

async function listVideoSubmissions(request: Request, env: Env) {
  const rows = await env.DB.prepare(`SELECT v.id, v.campaign_id, c.title AS campaign_title, v.creator_agent_id, a.name AS creator_name,
    v.video_id, v.youtube_url, v.title, v.channel_title, v.thumbnail_url, v.verification_status, v.created_at, v.verified_at
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
    createdAt: video.created_at,
    verifiedAt: video.verified_at,
  })) })
}

async function registerVideoSubmission(request: Request, env: Env) {
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

  const submissionId = `vid_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`
  const createdAt = new Date().toISOString()
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO video_submissions (id, campaign_id, creator_agent_id, video_id, youtube_url, title, channel_title, thumbnail_url, verification_status, created_at, verified_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'public_verified', ?, ?)`)
        .bind(submissionId, campaign.id, agent.id, videoId, verified.youtubeUrl, verified.title, verified.channelTitle, verified.thumbnailUrl, createdAt, createdAt),
      audit(env, { agentId: agent.id, campaignId: campaign.id, eventType: 'youtube.video_registered', payload: { submissionId, videoId, title: verified.title, channelTitle: verified.channelTitle, verificationStatus: 'public_verified' }, createdAt }),
    ])
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('UNIQUE constraint failed')) return error(request, env, 'VIDEO_ALREADY_REGISTERED', '이 캠페인 또는 영상은 이미 등록되어 있습니다.', 409)
    throw cause
  }
  return json(request, env, {
    submissionId,
    campaignId: campaign.id,
    campaignTitle: campaign.title,
    creatorAgentId: agent.id,
    creatorName: agent.name,
    videoId,
    youtubeUrl: verified.youtubeUrl,
    title: verified.title,
    channelTitle: verified.channelTitle,
    thumbnailUrl: verified.thumbnailUrl,
    verificationStatus: 'public_verified',
    createdAt,
    verifiedAt: createdAt,
  }, 201)
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
    if (request.method === 'POST' && url.pathname === '/api/videos') return registerVideoSubmission(request, env)
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
