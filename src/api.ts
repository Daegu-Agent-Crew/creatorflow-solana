export type AgentRole = 'brand' | 'creator'

export type Challenge = {
  challengeId: string
  message: string
  expiresAt: string
}

export type RegisteredAgent = {
  agentId: string
  name: string
  role: AgentRole
  wallet: string
  sessionToken: string
  sessionExpiresAt: string
  createdAt: string
}

export type Campaign = {
  id: string
  title: string
  brand_agent_id: string
  creator_agent_id: string | null
  status: 'negotiating' | 'accepted' | 'cancelled'
  accepted_offer_id: string | null
  created_at: string
  updated_at: string
}

export type Offer = {
  id: string
  campaign_id: string
  agent_id: string
  kind: 'offer' | 'counter'
  deliverable: string
  deadline: string
  deposit_usdc: string
  balance_usdc: string
  bonus_usdc: string
  kpi_threshold: number
  status: 'pending' | 'accepted' | 'rejected' | 'superseded'
  created_at: string
}

export type AgentSession = Pick<RegisteredAgent, 'agentId' | 'name' | 'role' | 'wallet' | 'sessionToken' | 'sessionExpiresAt'>

export type PublicAgent = Pick<RegisteredAgent, 'agentId' | 'name' | 'role' | 'wallet' | 'createdAt'>

export type AuditEvent = {
  eventId: string
  agentId: string | null
  agentName: string | null
  agentRole: AgentRole | null
  campaignId: string | null
  campaignTitle: string | null
  eventType: string
  payload: Record<string, unknown>
  createdAt: string
}

const sessionKey = 'creatorflow.agent-session'

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')

async function post<T>(path: string, body: Record<string, string>): Promise<T> {
  if (!apiBaseUrl) {
    throw new Error('등록 API 주소가 아직 설정되지 않았습니다. Cloudflare Worker 배포 후 다시 시도해 주세요.')
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? '요청을 처리하지 못했습니다.')
  return payload
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiBaseUrl) throw new Error('API 주소가 아직 설정되지 않았습니다.')
  const response = await fetch(`${apiBaseUrl}${path}`, init)
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? '요청을 처리하지 못했습니다.')
  return payload
}

function authenticatedHeaders(session: AgentSession) {
  return { authorization: `Bearer ${session.sessionToken}`, 'content-type': 'application/json' }
}

export function saveAgentSession(agent: RegisteredAgent) {
  const session: AgentSession = agent
  sessionStorage.setItem(sessionKey, JSON.stringify(session))
}

export function getAgentSession(): AgentSession | null {
  try {
    const raw = sessionStorage.getItem(sessionKey)
    if (!raw) return null
    const session = JSON.parse(raw) as AgentSession
    if (!session.sessionToken || session.sessionExpiresAt <= new Date().toISOString()) return null
    return session
  } catch {
    return null
  }
}

export function requestChallenge(input: { role: AgentRole; wallet: string; inviteCode?: string }) {
  return post<Challenge>('/api/auth/challenge', {
    role: input.role,
    wallet: input.wallet.trim(),
    ...(input.inviteCode ? { inviteCode: input.inviteCode.trim() } : {}),
  })
}

export function registerAgent(input: { challengeId: string; name: string; signature: string }) {
  return post<RegisteredAgent>('/api/agents/register', {
    challengeId: input.challengeId,
    name: input.name.trim(),
    signature: input.signature.trim(),
  })
}

export function listCampaigns() {
  return request<{ campaigns: Campaign[] }>('/api/campaigns')
}

export function listAgents() {
  return request<{ agents: PublicAgent[] }>('/api/agents')
}

export function listAuditEvents() {
  return request<{ events: AuditEvent[] }>('/api/audit')
}

export function getCampaign(campaignId: string) {
  return request<{ campaign: Campaign; offers: Offer[] }>(`/api/campaigns/${campaignId}`)
}

export function createCampaign(session: AgentSession, title: string) {
  return request<{ campaignId: string }>('/api/campaigns', {
    method: 'POST', headers: authenticatedHeaders(session), body: JSON.stringify({ title }),
  })
}

export function createOffer(session: AgentSession, campaignId: string, input: { kind: 'offer' | 'counter'; deliverable: string; deadline: string }) {
  return request<{ offerId: string }>(`/api/campaigns/${campaignId}/offers`, {
    method: 'POST',
    headers: authenticatedHeaders(session),
    body: JSON.stringify({ ...input, amounts: { deposit: '0.02', balance: '0.03', bonus: '0.01' }, kpi: { type: 'youtube_views', threshold: 100 } }),
  })
}

export function decideOffer(session: AgentSession, offerId: string, decision: 'accept' | 'reject') {
  return request<{ status: string }>(`/api/offers/${offerId}/${decision}`, {
    method: 'POST', headers: authenticatedHeaders(session), body: '{}',
  })
}
