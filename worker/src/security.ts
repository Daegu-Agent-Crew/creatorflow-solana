import bs58 from 'bs58'
import nacl from 'tweetnacl'

export type AgentRole = 'brand' | 'creator'

const namePattern = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{1,47}$/u

export function parseRole(value: unknown): AgentRole | null {
  return value === 'brand' || value === 'creator' ? value : null
}

export function isValidAgentName(value: unknown): value is string {
  return typeof value === 'string' && namePattern.test(value.trim())
}

export function decodePublicKey(value: unknown): Uint8Array | null {
  if (typeof value !== 'string') return null
  try {
    const bytes = bs58.decode(value)
    return bytes.length === nacl.sign.publicKeyLength ? bytes : null
  } catch {
    return null
  }
}

export function buildChallengeMessage(input: { id: string; wallet: string; role: AgentRole; expiresAt: string }) {
  return [
    'CreatorFlow Agent Registration',
    'Domain: creatorflow',
    `Challenge: ${input.id}`,
    `Wallet: ${input.wallet}`,
    `Role: ${input.role}`,
    `Expires: ${input.expiresAt}`,
    'This signature does not authorize a payment.',
  ].join('\n')
}

export function buildLoginChallengeMessage(input: { id: string; agentId: string; wallet: string; role: AgentRole; expiresAt: string }) {
  return [
    'CreatorFlow Agent Login',
    'Domain: creatorflow',
    `Challenge: ${input.id}`,
    `Agent: ${input.agentId}`,
    `Wallet: ${input.wallet}`,
    `Role: ${input.role}`,
    `Expires: ${input.expiresAt}`,
    'This signature does not authorize a payment.',
  ].join('\n')
}

export function verifyWalletSignature(input: { message: string; signature: string; wallet: string }) {
  const publicKey = decodePublicKey(input.wallet)
  if (!publicKey) return false
  try {
    const signature = bs58.decode(input.signature)
    if (signature.length !== nacl.sign.signatureLength) return false
    return nacl.sign.detached.verify(new TextEncoder().encode(input.message), signature, publicKey)
  } catch {
    return false
  }
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
