export type PayoutRecommendation = {
  fitScore: number
  tier: 'starter' | 'good' | 'strong' | 'top'
  amountUsdc: '0.01' | '0.02' | '0.03' | '0.05'
  amountBaseUnits: '10000' | '20000' | '30000' | '50000'
}

export function recommendCreatorPayout(fitScore: number): PayoutRecommendation | null {
  if (!Number.isInteger(fitScore) || fitScore < 0 || fitScore > 100) return null
  if (fitScore >= 90) return { fitScore, tier: 'top', amountUsdc: '0.05', amountBaseUnits: '50000' }
  if (fitScore >= 80) return { fitScore, tier: 'strong', amountUsdc: '0.03', amountBaseUnits: '30000' }
  if (fitScore >= 60) return { fitScore, tier: 'good', amountUsdc: '0.02', amountBaseUnits: '20000' }
  return { fitScore, tier: 'starter', amountUsdc: '0.01', amountBaseUnits: '10000' }
}

export function isPayoutWithinLimits(input: {
  amountBaseUnits: string
  campaignSpentBaseUnits: string
  dailySpentBaseUnits: string
  campaignCapBaseUnits?: string
  dailyCapBaseUnits?: string
}) {
  const values = [input.amountBaseUnits, input.campaignSpentBaseUnits, input.dailySpentBaseUnits, input.campaignCapBaseUnits ?? '300000', input.dailyCapBaseUnits ?? '100000']
  if (values.some((value) => !/^\d+$/.test(value))) return false
  const [amount, campaignSpent, dailySpent, campaignCap, dailyCap] = values.map(BigInt)
  return amount > 0n && campaignSpent + amount <= campaignCap && dailySpent + amount <= dailyCap
}
