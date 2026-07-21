import { useEffect, useState, type FormEvent } from 'react'
import { completeCreatorInviteActionV2, getCreatorInviteV2, requestCreatorInviteChallengeV2, type CreatorOfferV2 } from './api'
import { connectPhantom, signPhantomMessage } from './phantom'

export function CreatorInvitePage({ token }: { token: string }) {
  const [offer, setOffer] = useState<CreatorOfferV2 | null>(null)
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    getCreatorInviteV2(token)
      .then((result) => setOffer(result.offer))
      .catch((error) => setMessage(error instanceof Error ? error.message : '제안을 불러오지 못했습니다.'))
  }, [token])

  async function signAction(action: 'accept' | 'submit') {
    if (!offer) return
    setPending(true)
    setMessage('')
    try {
      const { provider, wallet } = await connectPhantom()
      if (offer.creatorWallet && offer.creatorWallet !== wallet) throw new Error('제안에 지정된 크리에이터 지갑을 Phantom에서 선택해 주세요.')
      const challenge = await requestCreatorInviteChallengeV2(token, { action, wallet, ...(action === 'submit' ? { youtubeUrl } : {}) })
      const signature = await signPhantomMessage(provider, challenge.message)
      const completed = await completeCreatorInviteActionV2(token, challenge.challengeId, signature)
      setOffer(completed.offer)
      setMessage(action === 'accept' ? '제안을 수락했습니다. 이제 YouTube 영상을 제출해 주세요.' : '영상과 채널 확인이 완료되었습니다.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '지갑 확인을 완료하지 못했습니다.')
    } finally {
      setPending(false)
    }
  }

  function submitVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void signAction('submit')
  }

  return (
    <main className="creator-invite-shell">
      <section className="creator-invite-card">
        <div className="invite-brand"><span>CF</span><strong>CreatorFlow</strong></div>
        {!offer && !message ? <p className="invite-loading">제안을 불러오는 중…</p> : null}
        {offer ? (
          <>
            <span className="kicker">YOUTUBE CREATOR 제안</span>
            <h1>{offer.creatorName}님,<br />영상 제작을 제안합니다.</h1>
            <div className="invite-summary">
              <div><span>캠페인</span><strong>{offer.campaignTitle}</strong></div>
              <div><span>YouTube 채널</span><strong>{offer.youtubeChannel}</strong></div>
              <div className="invite-amount"><span>지급 금액</span><strong>{offer.amountUsdc} USDC</strong></div>
            </div>
            <p className="invite-reason">{offer.aiRationale}</p>

            {offer.status === 'proposed' ? (
              <button className="primary-button invite-action" onClick={() => void signAction('accept')} disabled={pending}>{pending ? 'Phantom 확인 중…' : '제안 수락'}</button>
            ) : null}
            {offer.status === 'accepted' ? (
              <form className="invite-submit" onSubmit={submitVideo}>
                <label className="field"><span>YouTube 영상 주소</span><input type="url" value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} placeholder="https://youtu.be/…" required /></label>
                <button className="primary-button invite-action" disabled={pending}>{pending ? '영상 확인 중…' : '영상 제출'}</button>
              </form>
            ) : null}
            {offer.status === 'verified' ? <div className="invite-success"><strong>✓ 영상 검증 완료</strong><span>브랜드 AI의 지급 서명을 기다리고 있습니다.</span>{offer.video ? <a href={offer.video.youtubeUrl} target="_blank" rel="noreferrer">제출 영상 보기</a> : null}</div> : null}
            {offer.status === 'paid' ? <div className="invite-success"><strong>✓ 지급 완료</strong><span>{offer.amountUsdc} Devnet USDC 지급이 기록되었습니다.</span></div> : null}
            {offer.status === 'expired' || offer.status === 'rejected' ? <div className="invite-closed">종료된 제안입니다.</div> : null}
            {message ? <p className="api-message" role="status">{message}</p> : null}
            <p className="invite-safety">지갑 서명은 수락 또는 영상 제출 확인에만 사용됩니다. 결제 권한과 개인키를 요청하지 않습니다.</p>
          </>
        ) : message ? <p className="api-message" role="status">{message}</p> : null}
      </section>
    </main>
  )
}
