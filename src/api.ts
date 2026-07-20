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
  createdAt: string
}

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
