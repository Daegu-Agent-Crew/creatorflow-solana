import { useEffect, useState } from 'react'
import { confirmWalletDelegationRevocation, findWalletDelegationRecovery, listCampaigns, type Campaign } from './api'
import { connectPhantom } from './phantom'
import { revokeDevnetUsdcDelegate } from './solanaPayment'

export function WalletRecoveryPanel() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [campaignId, setCampaignId] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    listCampaigns().then((result) => { setCampaigns(result.campaigns); setCampaignId(result.campaigns[0]?.id ?? '') }).catch(() => setCampaigns([]))
  }, [])

  async function recover() {
    if (!campaignId) { setMessage('캠페인을 선택해 주세요.'); return }
    setPending(true); setMessage('')
    try {
      const { provider, wallet } = await connectPhantom()
      const found = await findWalletDelegationRecovery(wallet, campaignId)
      const signature = await revokeDevnetUsdcDelegate(provider, { ownerWallet: wallet, tokenAccount: found.delegation.tokenAccount })
      await confirmWalletDelegationRevocation(found.delegation.delegationId, signature)
      setMessage('기존 AI 지갑 권한을 해제했습니다. 새 AI 지갑을 등록해 다시 연결할 수 있습니다.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '긴급 권한 해제를 완료하지 못했습니다.')
    } finally { setPending(false) }
  }

  return (
    <article className="wallet-recovery-panel">
      <div><span className="kicker">AI 키 분실·교체</span><h2>사람 지갑으로 긴급 해제</h2><p>기존 AI에 로그인할 수 없어도 브랜드 Phantom 지갑만 있으면 남은 권한을 취소할 수 있습니다.</p></div>
      <div className="recovery-action">
        <select aria-label="긴급 해제 캠페인" value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>{campaigns.map((campaign) => <option value={campaign.id} key={campaign.id}>{campaign.title}</option>)}</select>
        <button className="secondary-button" onClick={() => void recover()} disabled={pending}>{pending ? 'Phantom 확인 중…' : '기존 AI 권한 해제'}</button>
      </div>
      {message ? <p className="api-message" role="status">{message}</p> : null}
    </article>
  )
}
