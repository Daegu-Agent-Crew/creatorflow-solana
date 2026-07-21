import { describe, expect, it } from 'vitest'
import { isPayoutWithinLimits, recommendCreatorPayout } from '../src/payout-policy'

describe('CreatorFlow2 payout policy', () => {
  it('maps creator fit to four transparent Devnet USDC tiers', () => {
    expect(recommendCreatorPayout(40)?.amountUsdc).toBe('0.01')
    expect(recommendCreatorPayout(60)?.amountUsdc).toBe('0.02')
    expect(recommendCreatorPayout(85)?.amountUsdc).toBe('0.03')
    expect(recommendCreatorPayout(95)?.amountUsdc).toBe('0.05')
    expect(recommendCreatorPayout(101)).toBeNull()
  })

  it('enforces campaign and daily delegated-wallet limits', () => {
    expect(isPayoutWithinLimits({ amountBaseUnits: '30000', campaignSpentBaseUnits: '60000', dailySpentBaseUnits: '50000' })).toBe(true)
    expect(isPayoutWithinLimits({ amountBaseUnits: '50000', campaignSpentBaseUnits: '270000', dailySpentBaseUnits: '0' })).toBe(false)
    expect(isPayoutWithinLimits({ amountBaseUnits: '30000', campaignSpentBaseUnits: '0', dailySpentBaseUnits: '80000' })).toBe(false)
  })
})
