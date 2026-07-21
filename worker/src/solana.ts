export const SOLANA_DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
export const VIDEO_PAYMENT_AMOUNT_BASE_UNITS = '30000'
export const VIDEO_PAYMENT_AMOUNT_USDC = '0.03'

type AccountKey = string | { pubkey?: unknown; signer?: unknown }
type ParsedInstruction = { program?: unknown; parsed?: unknown }
type TokenBalance = { accountIndex?: unknown; mint?: unknown; owner?: unknown }

function publicKey(value: AccountKey) {
  return typeof value === 'string' ? value : typeof value.pubkey === 'string' ? value.pubkey : ''
}

function instructionList(transaction: Record<string, unknown>) {
  const message = transaction.transaction && typeof transaction.transaction === 'object'
    ? (transaction.transaction as Record<string, unknown>).message
    : null
  const topLevel = message && typeof message === 'object' && Array.isArray((message as Record<string, unknown>).instructions)
    ? (message as Record<string, unknown>).instructions as ParsedInstruction[]
    : []
  const meta = transaction.meta && typeof transaction.meta === 'object' ? transaction.meta as Record<string, unknown> : null
  const inner = meta && Array.isArray(meta.innerInstructions)
    ? meta.innerInstructions.flatMap((entry) => entry && typeof entry === 'object' && Array.isArray((entry as Record<string, unknown>).instructions) ? (entry as Record<string, unknown>).instructions as ParsedInstruction[] : [])
    : []
  return [...topLevel, ...inner]
}

export function verifyDevnetUsdcPayment(transaction: unknown, expected: { senderWallet: string; recipientWallet: string; mint: string; amountBaseUnits: string; memo: string }) {
  if (!transaction || typeof transaction !== 'object') return false
  const value = transaction as Record<string, unknown>
  const meta = value.meta && typeof value.meta === 'object' ? value.meta as Record<string, unknown> : null
  if (!meta || meta.err !== null) return false
  const transactionRecord = value.transaction && typeof value.transaction === 'object' ? value.transaction as Record<string, unknown> : null
  const message = transactionRecord?.message && typeof transactionRecord.message === 'object' ? transactionRecord.message as Record<string, unknown> : null
  const accountKeys = message && Array.isArray(message.accountKeys) ? message.accountKeys as AccountKey[] : []
  const senderSigned = accountKeys.some((key) => publicKey(key) === expected.senderWallet && typeof key === 'object' && key.signer === true)
  if (!senderSigned) return false

  const instructions = instructionList(value)
  const transfer = instructions.find((instruction) => {
    if (instruction.program !== 'spl-token' || !instruction.parsed || typeof instruction.parsed !== 'object') return false
    const parsed = instruction.parsed as Record<string, unknown>
    if (parsed.type !== 'transferChecked' || !parsed.info || typeof parsed.info !== 'object') return false
    const info = parsed.info as Record<string, unknown>
    const tokenAmount = info.tokenAmount && typeof info.tokenAmount === 'object' ? info.tokenAmount as Record<string, unknown> : null
    return info.authority === expected.senderWallet && info.mint === expected.mint && tokenAmount?.amount === expected.amountBaseUnits && tokenAmount.decimals === 6
  })
  if (!transfer || !transfer.parsed || typeof transfer.parsed !== 'object') return false
  const info = (transfer.parsed as Record<string, unknown>).info as Record<string, unknown>
  const destination = typeof info.destination === 'string' ? info.destination : ''
  const postBalances = Array.isArray(meta.postTokenBalances) ? meta.postTokenBalances as TokenBalance[] : []
  const recipientOwnsDestination = postBalances.some((balance) => {
    if (balance.mint !== expected.mint || balance.owner !== expected.recipientWallet || typeof balance.accountIndex !== 'number') return false
    return publicKey(accountKeys[balance.accountIndex] ?? '') === destination
  })
  if (!recipientOwnsDestination) return false

  return instructions.some((instruction) => instruction.program === 'spl-memo' && instruction.parsed === expected.memo)
}

export async function fetchDevnetTransaction(signature: string, rpcUrl = 'https://api.devnet.solana.com') {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(signature)) return null
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }] }),
  })
  if (!response.ok) return null
  const payload = await response.json() as { result?: unknown }
  return payload.result ?? null
}
