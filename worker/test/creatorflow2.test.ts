import { describe, expect, it } from 'vitest'
import { buildCreatorOfferActionMessage } from '../src/security'
import { recommendCreatorPayout } from '../src/payout-policy'

describe('CreatorFlow2 human creator contract', () => {
  it('keeps accept and submit as distinct wallet statements', () => {
    const common = { offerId: 'cfo_test', campaignId: 'cmp_test', wallet: 'wallet_test', amountUsdc: '0.03', confirmationCode: 'ABC12345' }
    const accept = buildCreatorOfferActionMessage({ ...common, action: 'accept' })
    const submit = buildCreatorOfferActionMessage({ ...common, action: 'submit', videoId: 'I96Mwbm7Tp0' })
    expect(accept).toContain('제안 수락')
    expect(accept).not.toContain('영상:')
    expect(submit).toContain('영상 제출')
    expect(submit).toContain('영상: I96Mwbm7Tp0')
    expect(submit).toContain('결제 권한을 부여하지 않습니다')
  })

  it('uses the server payout tier instead of a client supplied amount', () => {
    expect(recommendCreatorPayout(86)).toMatchObject({ amountUsdc: '0.03', amountBaseUnits: '30000' })
  })
})
