import { useState, type FormEvent } from 'react'
import { createCreatorOfferV2, getAgentSession } from './api'

export function OfferComposer({ campaignId, onClose, onCreated, onManage }: { campaignId: string | null; onClose: () => void; onCreated: () => void; onManage: () => void }) {
  const [creatorName, setCreatorName] = useState('')
  const [youtubeChannel, setYoutubeChannel] = useState('')
  const [fitScore, setFitScore] = useState('80')
  const [inviteUrl, setInviteUrl] = useState('')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const session = getAgentSession()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session || session.role !== 'brand') { setMessage('브랜드 AI 지갑으로 먼저 로그인해 주세요.'); return }
    if (!campaignId) { setMessage('제안을 연결할 캠페인이 없습니다.'); return }
    setPending(true); setMessage('')
    try {
      const result = await createCreatorOfferV2(session, { campaignId, creatorName, youtubeChannel, fitScore: Number(fitScore) })
      const url = new URL(window.location.href)
      url.search = `?invite=${result.inviteToken}`
      url.hash = ''
      setInviteUrl(url.toString())
      onCreated()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '제안을 만들지 못했습니다.')
    } finally { setPending(false) }
  }

  return (
    <div className="detail-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="offer-composer" role="dialog" aria-modal="true" aria-label="새 크리에이터 제안" onMouseDown={(event) => event.stopPropagation()}>
        <button className="detail-close" onClick={onClose} aria-label="닫기">×</button>
        <span className="kicker">브랜드 AI 실행</span>
        <h2>새 크리에이터 제안</h2>
        {!session || session.role !== 'brand' ? (
          <div className="composer-login"><p>브랜드 AI 지갑 로그인이 필요합니다.</p><button className="primary-button" onClick={onManage}>AI 지갑 로그인</button></div>
        ) : inviteUrl ? (
          <div className="invite-link-result">
            <strong>제안 링크가 준비됐습니다.</strong>
            <p>{creatorName}님은 이 링크에서 수락과 영상 제출만 하면 됩니다.</p>
            <input value={inviteUrl} readOnly aria-label="크리에이터 제안 링크" />
            <button className="primary-button" onClick={() => navigator.clipboard.writeText(inviteUrl)}>링크 복사</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label className="field"><span>크리에이터 이름</span><input value={creatorName} onChange={(event) => setCreatorName(event.target.value)} placeholder="예: 대구루" required /></label>
            <label className="field"><span>YouTube 채널명</span><input value={youtubeChannel} onChange={(event) => setYoutubeChannel(event.target.value)} placeholder="영상에 표시되는 채널명" required /></label>
            <label className="field"><span>AI 적합도 (0~100)</span><input type="number" min="0" max="100" step="1" value={fitScore} onChange={(event) => setFitScore(event.target.value)} required /></label>
            <div className="payout-preview"><span>시스템 제안 금액</span><strong>{Number(fitScore) >= 90 ? '0.05' : Number(fitScore) >= 80 ? '0.03' : Number(fitScore) >= 60 ? '0.02' : '0.01'} USDC</strong></div>
            <button className="primary-button full-button" disabled={pending}>{pending ? '제안 생성 중…' : '제안 링크 만들기'}</button>
          </form>
        )}
        {message ? <p className="api-message" role="status">{message}</p> : null}
      </aside>
    </div>
  )
}
