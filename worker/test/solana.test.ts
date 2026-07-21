import { describe, expect, it } from 'vitest'
import { SOLANA_DEVNET_USDC_MINT, verifyDevnetUsdcDelegation, verifyDevnetUsdcPayment, verifyDevnetUsdcRevocation } from '../src/solana'

const sender = 'FWmGGKtczrdtWQJNdimApAfzBxEKdoDFwCFQtP9DEB5i'
const recipient = '6Q9CuC2unLNda5Hb1RojyKvCkVyZnWLBjyvEPuidoQuG'
const destination = 'CreatorUsdcTokenAccount111111111111111111111'
const source = 'BrandUsdcTokenAccount11111111111111111111111'
const delegate = 'AiDelegate111111111111111111111111111111111'
const memo = 'CreatorFlow:pay_test'

function transactionFixture(amount = '30000', failed = false): any {
  return {
    meta: {
      err: failed ? { custom: 1 } : null,
      preTokenBalances: [{ accountIndex: 2, mint: SOLANA_DEVNET_USDC_MINT, owner: sender }],
      postTokenBalances: [{ accountIndex: 1, mint: SOLANA_DEVNET_USDC_MINT, owner: recipient }],
      innerInstructions: [],
    },
    transaction: {
      message: {
        accountKeys: [{ pubkey: sender, signer: true }, { pubkey: destination, signer: false }, { pubkey: source, signer: false }],
        instructions: [
          { program: 'spl-token', parsed: { type: 'transferChecked', info: { authority: sender, source, destination, mint: SOLANA_DEVNET_USDC_MINT, tokenAmount: { amount, decimals: 6 } } } },
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

  it('accepts a delegated AI signature only for a brand-owned source account', () => {
    const delegated = transactionFixture()
    delegated.transaction.message.accountKeys[0] = { pubkey: delegate, signer: true }
    delegated.transaction.message.accountKeys.push({ pubkey: sender, signer: false })
    delegated.transaction.message.instructions[0].parsed.info.authority = delegate
    expect(verifyDevnetUsdcPayment(delegated, { ...expected, authorityWallet: delegate })).toBe(true)
    delegated.meta.preTokenBalances[0].owner = recipient
    expect(verifyDevnetUsdcPayment(delegated, { ...expected, authorityWallet: delegate })).toBe(false)
  })

  it('verifies exact approveChecked and revoke instructions', () => {
    const approval = transactionFixture()
    approval.transaction.message.instructions[0] = { program: 'spl-token', parsed: { type: 'approveChecked', info: { account: source, owner: sender, delegate, mint: SOLANA_DEVNET_USDC_MINT, tokenAmount: { amount: '100000', decimals: 6 } } } }
    expect(verifyDevnetUsdcDelegation(approval, { ownerWallet: sender, delegateWallet: delegate, mint: SOLANA_DEVNET_USDC_MINT, allowanceBaseUnits: '100000' })).toEqual({ tokenAccount: source })
    approval.transaction.message.instructions[0] = { program: 'spl-token', parsed: { type: 'revoke', info: { account: source, owner: sender } } }
    expect(verifyDevnetUsdcRevocation(approval, { ownerWallet: sender, tokenAccount: source })).toBe(true)
  })
})
