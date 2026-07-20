import { describe, expect, it } from 'vitest'
import { parseOfferKind, parseUsdcMicros, validateOfferTerms } from '../src/negotiation'

describe('negotiation policy', () => {
  it('converts decimal USDC without floating point arithmetic', () => {
    expect(parseUsdcMicros('0.02')).toBe(20_000)
    expect(parseUsdcMicros('1.000001')).toBe(1_000_001)
    expect(parseUsdcMicros('0.0000001')).toBeNull()
    expect(parseUsdcMicros('-1')).toBeNull()
  })

  it('accepts only offer and counter kinds', () => {
    expect(parseOfferKind('offer')).toBe('offer')
    expect(parseOfferKind('counter')).toBe('counter')
    expect(parseOfferKind('accept')).toBeNull()
  })

  it('enforces the 0.10 USDC campaign cap', () => {
    const base = {
      deliverable: 'YouTube 브랜드 영상',
      deadline: '2026-07-30T12:00:00Z',
      kpi: { type: 'youtube_views', threshold: 100 },
    }
    expect(validateOfferTerms({ ...base, amounts: { deposit: '0.02', balance: '0.03', bonus: '0.01' } })).not.toBeNull()
    expect(validateOfferTerms({ ...base, amounts: { deposit: '0.05', balance: '0.05', bonus: '0.01' } })).toBeNull()
  })
})
