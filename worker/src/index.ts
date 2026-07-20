import { buildChallengeMessage, decodePublicKey, isValidAgentName, parseRole, sha256, verifyWalletSignature } from './security'

interface Env {
  DB: D1Database
  ALLOWED_ORIGIN?: string
}

type JsonRecord = Record<string, unknown>

function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get('origin') ?? ''
  const allowed = env.ALLOWED_ORIGIN ?? 'https://daegu-agent-crew.github.io'
  const workerHost = new URL(request.url).hostname
  const localWorker = workerHost === 'localhost' || workerHost === '127.0.0.1'
  const localOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  const responseOrigin = origin === allowed || (localWorker && localOrigin) ? origin : allowed
  return {
    'access-control-allow-origin': responseOrigin,
    'access-control-allow-headers': 'content-type',
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
  const statements = [
    env.DB.prepare('UPDATE auth_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL').bind(createdAt, challenge.id),
    env.DB.prepare('INSERT INTO agents (id, name, role, wallet, challenge_id, invite_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(agentId, name, challenge.role, challenge.wallet, challenge.id, challenge.invite_id, createdAt),
    env.DB.prepare('INSERT INTO audit_events (id, agent_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), agentId, 'agent.registered', JSON.stringify({ role: challenge.role, wallet: challenge.wallet }), createdAt),
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
  return json(request, env, { agentId, name, role: challenge.role, wallet: challenge.wallet, createdAt }, 201)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) })
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/api/health') return json(request, env, { ok: true, service: 'creatorflow-api' })
    if (request.method === 'POST' && url.pathname === '/api/auth/challenge') return createChallenge(request, env)
    if (request.method === 'POST' && url.pathname === '/api/agents/register') return registerAgent(request, env)
    return json(request, env, { error: '요청한 API를 찾을 수 없습니다.' }, 404)
  },
}
