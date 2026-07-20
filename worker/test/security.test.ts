import bs58 from 'bs58'
import nacl from 'tweetnacl'
import { describe, expect, it } from 'vitest'
import { buildChallengeMessage, buildLoginChallengeMessage, decodePublicKey, isValidAgentName, parseRole, verifyWalletSignature } from '../src/security'

describe('agent registration security', () => {
  it('accepts only supported roles and valid names', () => {
    expect(parseRole('creator')).toBe('creator')
    expect(parseRole('admin')).toBeNull()
    expect(isValidAgentName('크리에이터 스튜디오')).toBe(true)
    expect(isValidAgentName('<script>')).toBe(false)
  })

  it('accepts a 32-byte Solana public key', () => {
    const keypair = nacl.sign.keyPair()
    expect(decodePublicKey(bs58.encode(keypair.publicKey))).toEqual(keypair.publicKey)
    expect(decodePublicKey('invalid')).toBeNull()
  })

  it('verifies the exact challenge and rejects tampering', () => {
    const keypair = nacl.sign.keyPair()
    const wallet = bs58.encode(keypair.publicKey)
    const message = buildChallengeMessage({ id: 'challenge-1', wallet, role: 'creator', expiresAt: '2026-07-20T10:00:00.000Z' })
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey))
    expect(verifyWalletSignature({ message, signature, wallet })).toBe(true)
    expect(verifyWalletSignature({ message: `${message}\nchanged`, signature, wallet })).toBe(false)
  })
})

describe('wallet login challenge', () => {
  it('binds the signature to the existing agent, wallet, role, and expiry', () => {
    expect(buildLoginChallengeMessage({
      id: 'login-1',
      agentId: 'agt_existing',
      wallet: 'wallet-address',
      role: 'creator',
      expiresAt: '2026-07-21T01:02:03.000Z',
    })).toBe([
      'CreatorFlow Agent Login',
      'Domain: creatorflow',
      'Challenge: login-1',
      'Agent: agt_existing',
      'Wallet: wallet-address',
      'Role: creator',
      'Expires: 2026-07-21T01:02:03.000Z',
      'This signature does not authorize a payment.',
    ].join('\n'))
  })
})
