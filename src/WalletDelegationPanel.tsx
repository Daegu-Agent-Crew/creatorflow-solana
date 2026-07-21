import { useEffect, useState } from 'react'
import { confirmWalletDelegation, confirmWalletDelegationRevocation, getAgentSession, getWalletDelegation, type WalletDelegation } from './api'
import { connectPhantom } from './phantom'
import { approveDevnetUsdcDelegate, revokeDevnetUsdcDelegate } from './solanaPayment'

const brandOwnerWallet = 'FWmGGKtczrdtWQJNdimApAfzBxEKdoDFwCFQtP9DEB5i'
const devnetUsdcMint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
const allowanceBaseUnits = '100000'

function shortWallet(wallet: string) { return `${wallet.slice(0, 6)}…${wallet.slice(-4)}` }

export function WalletDelegationPanel({ refreshKey }: { refreshKey: number }) {
  const [delegation, setDelegation] = useState<WalletDelegation | null>(null)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const session = getAgentSession()
  const sessionAgentId = session?.agentId
  const sessionRole = session?.role

  useEffect(() => {
    const current = getAgentSession()
    if (!current || sessionRole !== 'brand') return
    getWalletDelegation(current).then((result) => setDelegation(result.delegation)).catch(() => setDelegation(null))
  }, [refreshKey, sessionAgentId, sessionRole])

  async function approve() {
    const current = getAgentSession()
    if (!current || current.role !== 'brand') { setMessage('먼저 브랜드 AI 지갑으로 로그인해 주세요.'); return }
    if (current.wallet === brandOwnerWallet) { setMessage('사람 지갑과 다른 OpenClaw AI 전용 지갑으로 로그인해야 합니다.'); return }
    setPending(true); setMessage('')
    try {
      const { provider, wallet } = await connectPhantom()
      if (wallet !== brandOwnerWallet) throw new Error('브랜드 사람 지갑(FWmG…EB5i)을 Phantom에서 선택해 주세요.')
      const result = await approveDevnetUsdcDelegate(provider, { ownerWallet: wallet, delegateWallet: current.wallet, mint: devnetUsdcMint, allowanceBaseUnits })
      const confirmed = await confirmWalletDelegation(current, { ownerWallet: wallet, transactionSignature: result.transactionSignature, allowanceBaseUnits })
      setDelegation(confirmed.delegation)
      setMessage('브랜드 AI에 0.10 Devnet USDC 한도를 연결했습니다.')
    } catch (error) { setMessage(error instanceof Error ? error.message : '지갑 위임을 완료하지 못했습니다.') }
    finally { setPending(false) }
  }

  async function revoke() {
    const current = getAgentSession()
    if (!current || !delegation) return
    setPending(true); setMessage('')
    try {
      const { provider, wallet } = await connectPhantom()
      if (wallet !== delegation.ownerWallet) throw new Error('위임한 브랜드 사람 지갑을 Phantom에서 선택해 주세요.')
      const signature = await revokeDevnetUsdcDelegate(provider, { ownerWallet: wallet, tokenAccount: delegation.tokenAccount })
      const confirmed = await confirmWalletDelegationRevocation(current, signature)
      setDelegation(confirmed.delegation)
      setMessage('AI 지갑의 남은 지급 권한을 해제했습니다.')
    } catch (error) { setMessage(error instanceof Error ? error.message : '위임 해제를 완료하지 못했습니다.') }
    finally { setPending(false) }
  }

  return (
    <article className="wallet-delegation-panel">
      <div className="section-heading"><div><span className="kicker">사람 지갑 → 브랜드 AI 지갑</span><h2>AI 지급 한도</h2></div><span className={`state-badge ${delegation?.status === 'active' ? '' : 'muted-badge'}`}>{delegation?.status === 'active' ? '연결됨' : '연결 전'}</span></div>
      <div className="delegation-content">
        <div>
          <strong>{delegation?.status === 'active' ? `${delegation.allowanceUsdc} USDC까지 AI가 서명` : '캠페인용 0.10 USDC만 허용'}</strong>
          <p>USDC는 사람 지갑에 그대로 있고, AI는 정해진 한도 안에서만 지급합니다. AI 키를 잃으면 사람 지갑으로 즉시 해제할 수 있습니다.</p>
          {session?.role === 'brand' ? <small>AI 지갑: {shortWallet(session.wallet)}</small> : <small>브랜드 AI 지갑 로그인이 필요합니다.</small>}
        </div>
        {delegation?.status === 'active'
          ? <button className="secondary-button" onClick={revoke} disabled={pending}>{pending ? '확인 중…' : '권한 해제'}</button>
          : <button className="primary-button" onClick={approve} disabled={pending}>{pending ? 'Phantom 확인 중…' : '0.10 USDC 한도 연결'}</button>}
      </div>
      {message ? <p className="api-message" role="status">{message}</p> : null}
    </article>
  )
}
