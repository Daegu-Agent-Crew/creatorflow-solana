import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createCampaign, createOffer, decideOffer, getAgentSession, getCampaign, listCampaigns, type Campaign, type Offer } from './api'

export function NegotiationPanel() {
  const session = getAgentSession()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [offers, setOffers] = useState<Offer[]>([])
  const [title, setTitle] = useState('CreatorFlow 소개 영상')
  const [deliverable, setDeliverable] = useState('YouTube 브랜드 영상 1편')
  const [deadline, setDeadline] = useState('2026-07-30T21:00')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)

  const selected = campaigns.find((campaign) => campaign.id === selectedId)
  const actionableOffer = useMemo(
    () => offers.findLast((offer) => offer.status === 'pending' && offer.agent_id !== session?.agentId),
    [offers, session?.agentId],
  )

  async function refresh(preferredId?: string) {
    const result = await listCampaigns()
    setCampaigns(result.campaigns)
    const nextId = preferredId ?? selectedId ?? result.campaigns[0]?.id ?? ''
    setSelectedId(nextId)
    if (nextId) {
      const detail = await getCampaign(nextId)
      setOffers(detail.offers)
    } else setOffers([])
  }

  useEffect(() => {
    listCampaigns()
      .then(async (result) => {
        setCampaigns(result.campaigns)
        const firstId = result.campaigns[0]?.id ?? ''
        setSelectedId(firstId)
        if (firstId) setOffers((await getCampaign(firstId)).offers)
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : '캠페인을 불러오지 못했습니다.'))
  }, [])

  async function run(action: () => Promise<void>) {
    setPending(true)
    setMessage('')
    try { await action() } catch (error) { setMessage(error instanceof Error ? error.message : '요청을 처리하지 못했습니다.') } finally { setPending(false) }
  }

  function submitCampaign(event: FormEvent) {
    event.preventDefault()
    if (!session) return
    run(async () => {
      const created = await createCampaign(session, title)
      await refresh(created.campaignId)
      setMessage('캠페인을 만들었습니다. 이제 첫 조건을 제안하세요.')
    })
  }

  function submitOffer(event: FormEvent) {
    event.preventDefault()
    if (!session || !selectedId) return
    run(async () => {
      await createOffer(session, selectedId, {
        kind: session.role === 'brand' ? 'offer' : 'counter',
        deliverable,
        deadline: new Date(deadline).toISOString(),
      })
      await refresh(selectedId)
      setMessage(session.role === 'brand' ? '조건을 제안했습니다.' : '수정 조건을 제안했습니다.')
    })
  }

  function acceptOffer() {
    if (!session || !actionableOffer) return
    run(async () => {
      await decideOffer(session, actionableOffer.id, 'accept')
      await refresh(selectedId)
      setMessage('양쪽 에이전트의 계약이 확정됐습니다.')
    })
  }

  return (
    <article className="negotiation-panel">
      <div className="section-heading">
        <div><span className="kicker">AGENT 협상 작업대</span><h2>제안하고 합의하기</h2></div>
        <span className={`state-badge ${session ? '' : 'muted-badge'}`}>{session ? `${session.name} · ${session.role === 'brand' ? '브랜드' : '크리에이터'}` : '등록 필요'}</span>
      </div>

      {!session ? <p className="empty-note">에이전트 탭에서 지갑 서명 등록을 마치면 이 브라우저에서 캠페인 제안과 수락을 진행할 수 있습니다.</p> : (
        <div className="negotiation-grid">
          <div className="campaign-list">
            <strong>공개 캠페인</strong>
            {campaigns.length ? campaigns.map((campaign) => (
              <button key={campaign.id} className={campaign.id === selectedId ? 'active' : ''} onClick={() => run(async () => { setSelectedId(campaign.id); const detail = await getCampaign(campaign.id); setOffers(detail.offers) })}>
                <span>{campaign.title}</span><small>{campaign.status === 'accepted' ? '합의 완료' : '협상 중'} · {campaign.id}</small>
              </button>
            )) : <p>아직 캠페인이 없습니다.</p>}
            {session.role === 'brand' ? (
              <form className="inline-form" onSubmit={submitCampaign}>
                <label className="field"><span>새 캠페인 이름</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
                <button className="secondary-button" disabled={pending}>캠페인 만들기</button>
              </form>
            ) : null}
          </div>

          <form className="offer-form" onSubmit={submitOffer}>
            <strong>{selected ? selected.title : '캠페인을 선택하세요'}</strong>
            {selected ? <>
              <label className="field"><span>제작 결과물</span><input value={deliverable} onChange={(event) => setDeliverable(event.target.value)} /></label>
              <label className="field"><span>마감</span><input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label>
              <div className="fixed-terms"><span>선금 0.02</span><span>잔금 0.03</span><span>보너스 0.01 USDC</span></div>
              {selected.status === 'negotiating' ? <button className="primary-button full-button" disabled={pending}>{session.role === 'brand' ? '조건 제안' : '수정 조건 제안'}</button> : null}
              {actionableOffer && selected.status === 'negotiating' ? <button className="secondary-button full-button" type="button" onClick={acceptOffer} disabled={pending}>상대 제안 수락</button> : null}
              <p className="helper-text">모든 제안과 수락은 D1 감사 기록에 남습니다.</p>
            </> : null}
          </form>
        </div>
      )}
      {message ? <p className="api-message" role="status">{message}</p> : null}
    </article>
  )
}
