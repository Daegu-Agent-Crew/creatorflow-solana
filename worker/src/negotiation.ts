export type OfferKind = 'offer' | 'counter'

export type OfferTerms = {
  deliverable: string
  deadline: string
  depositUsdc: string
  balanceUsdc: string
  bonusUsdc: string
  kpiThreshold: number
}

const textPattern = /^[^<>]{3,160}$/u
const usdcPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/

export function parseOfferKind(value: unknown): OfferKind | null {
  return value === 'offer' || value === 'counter' ? value : null
}

export function parseUsdcMicros(value: unknown): number | null {
  if (typeof value !== 'string' || !usdcPattern.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  const micros = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, '0'))
  return Number.isSafeInteger(micros) ? micros : null
}

export function validateOfferTerms(value: unknown): OfferTerms | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const amounts = input.amounts && typeof input.amounts === 'object' && !Array.isArray(input.amounts)
    ? input.amounts as Record<string, unknown>
    : null
  const kpi = input.kpi && typeof input.kpi === 'object' && !Array.isArray(input.kpi)
    ? input.kpi as Record<string, unknown>
    : null
  const deliverable = typeof input.deliverable === 'string' ? input.deliverable.trim() : ''
  const deadline = typeof input.deadline === 'string' ? input.deadline : ''
  const deposit = parseUsdcMicros(amounts?.deposit)
  const balance = parseUsdcMicros(amounts?.balance)
  const bonus = parseUsdcMicros(amounts?.bonus)
  const threshold = kpi?.type === 'youtube_views' && Number.isInteger(kpi.threshold) ? Number(kpi.threshold) : 0
  const deadlineMs = Date.parse(deadline)

  if (!textPattern.test(deliverable) || !Number.isFinite(deadlineMs)) return null
  if (deposit === null || balance === null || bonus === null || deposit + balance + bonus > 100_000) return null
  if (threshold < 1 || threshold > 10_000_000) return null
  return {
    deliverable,
    deadline: new Date(deadlineMs).toISOString(),
    depositUsdc: amounts?.deposit as string,
    balanceUsdc: amounts?.balance as string,
    bonusUsdc: amounts?.bonus as string,
    kpiThreshold: threshold,
  }
}
