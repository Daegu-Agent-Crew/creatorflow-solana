import { useEffect, useState } from 'react'
import { confirmPayment, createPaymentRequest, getAgentSession, listPayments, type PaymentRequest, type VideoSubmission } from './api'
import { connectPhantom } from './phantom'
import { sendDevnetUsdcPayment } from './solanaPayment'

export function PaymentPanel({ video, onLogin }: { video: VideoSubmission | undefined; onLogin: () => void }) {
  const [payment, setPayment] = useState<PaymentRequest | null>(null)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!video) return
    listPayments()
      .then((result) => setPayment(result.payments.find((item) => item.campaignId === video.campaignId) ?? null))
      .catch((error) => setMessage(error instanceof Error ? error.message : '지급 기록을 불러오지 못했습니다.'))
  }, [video])

  async function pay() {
    const session = getAgentSession()
    if (!session) {
      setMessage('브랜드 에이전트로 로그인해 주세요.')
      return
    }
    if (session.role !== 'brand') {
      setMessage('현재 크리에이터 에이전트로 로그인되어 있습니다. 브랜드 에이전트로 다시 로그인해 주세요.')
      return
    }
    if (!video) return
    setPending(true)
    setMessage('')
    try {
      const requested = await createPaymentRequest(session, video.campaignId)
      setPayment(requested)
      if (requested.status === 'confirmed') {
        setMessage('이미 0.03 USDC 지급이 완료됐습니다.')
        return
      }
      const { provider, wallet } = await connectPhantom()
      if (wallet !== requested.senderWallet) throw new Error('브랜드 Agent 지갑과 Phantom 지갑이 다릅니다.')
      const transactionSignature = await sendDevnetUsdcPayment(provider, requested)
      const confirmed = await confirmPayment(session, requested.paymentId, transactionSignature)
      setPayment(confirmed)
      setMessage('대구루에게 0.03 Devnet USDC 지급을 완료했습니다.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'USDC 지급을 완료하지 못했습니다.')
    } finally {
      setPending(false)
    }
  }

  if (!video) return null
  return (
    <article className="payment-panel">
      <div className="section-heading">
        <div><span className="kicker">SOLANA DEVNET 지급</span><h2>영상 공개 마일스톤</h2></div>
        <span className={`state-badge ${payment?.status === 'confirmed' ? '' : 'muted-badge'}`}>{payment?.status === 'confirmed' ? '지급 완료' : '0.03 USDC'}</span>
      </div>
      <div className="payment-content">
        <div>
          <strong>{video.creatorName}에게 0.03 USDC</strong>
          <p>{video.creatorSigned ? '크리에이터 제출 서명이 확인됐습니다. 브랜드 지갑 승인 후 전송합니다.' : '먼저 대구루의 영상 제출 서명이 필요합니다.'}</p>
        </div>
        {payment?.status === 'confirmed' && payment.transactionSignature ? (
          <a className="secondary-button payment-link" href={`https://explorer.solana.com/tx/${payment.transactionSignature}?cluster=devnet`} target="_blank" rel="noreferrer">Solana 거래 보기</a>
        ) : (
          <button className="primary-button" onClick={pay} disabled={pending || !video.creatorSigned}>{pending ? 'Phantom 확인 중…' : '0.03 USDC 지급 승인'}</button>
        )}
      </div>
      {!getAgentSession() && video.creatorSigned ? <button className="secondary-button login-helper" onClick={onLogin}>브랜드 로그인</button> : null}
      {message ? <p className="api-message" role="status">{message}</p> : null}
    </article>
  )
}
