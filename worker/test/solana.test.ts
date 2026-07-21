import { describe, expect, it } from 'vitest'
import { SOLANA_DEVNET_USDC_MINT, verifyDevnetUsdcPayment } from '../src/solana'

const sender = 'FWmGGKtczrdtWQJNdimApAfzBxEKdoDFwCFQtP9DEB5i'
const recipient = '6Q9CuC2unLNda5Hb1RojyKvCkVyZnWLBjyvEPuidoQuG'
const destination = 'CreatorUsdcTokenAccount111111111111111111111'
const memo = 'CreatorFlow:pay_test'

function transactionFixture(amount = '30000', failed = false) {
  return {
    meta: {
      err: failed ? { custom: 1 } : null,
      postTokenBalances: [{ accountIndex: 1, mint: SOLANA_DEVNET_USDC_MINT, owner: recipient }],
      innerInstructions: [],
    },
    transaction: {
      message: {
        accountKeys: [{ pubkey: sender, signer: true }, { pubkey: destination, signer: false }],
        instructions: [
          { program: 'spl-token', parsed: { type: 'transferChecked', info: { authority: sender, destination, mint: SOLANA_DEVNET_USDC_MINT, tokenAmount: { amount, decimals: 6 } } } },
          { program: 'spl-memo', parsed: memo },
        ],
      },
    },
  }
}

const expected = { senderWallet: sender, recipientWallet: recipient, mint: SOLANA_DEVNET_USDC_MINT, amountBaseUnits: '30000', memo }

describe('Solana Devnet USDC payment verification', () => {
  it('accepts an exact signed transfer and memo', () => {
    expect(verifyDevnetUsdcPayment(transactionFixture(), expected)).toBe(true)
  })

  it('rejects the wrong amount, recipient, or memo', () => {
    expect(verifyDevnetUsdcPayment(transactionFixture('30001'), expected)).toBe(false)
    expect(verifyDevnetUsdcPayment(transactionFixture(), { ...expected, recipientWallet: sender })).toBe(false)
    expect(verifyDevnetUsdcPayment(transactionFixture(), { ...expected, memo: 'CreatorFlow:other' })).toBe(false)
  })

  it('rejects failed or unsigned transactions', () => {
    const failed = transactionFixture('30000', true)
    expect(verifyDevnetUsdcPayment(failed, expected)).toBe(false)
    const unsigned = transactionFixture()
    unsigned.transaction.message.accountKeys[0].signer = false
    expect(verifyDevnetUsdcPayment(unsigned, expected)).toBe(false)
  })
})
