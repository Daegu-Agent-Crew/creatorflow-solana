import { useCallback, useEffect, useMemo, useState } from 'react'
import { getCreatorFlow2Pipeline, type CreatorFlow2Pipeline, type PipelineCreator, type PipelineStage } from './api'

const columns: Array<{ stage: PipelineStage; label: string; empty: string }> = [
  { stage: 'proposed', label: '제안', empty: '새 제안 없음' },
  { stage: 'accepted', label: '수락', empty: '수락 대기' },
  { stage: 'submitted', label: '영상 제출', empty: '제출 대기' },
  { stage: 'verified', label: '검증', empty: '검증 대기' },
  { stage: 'paid', label: '지급', empty: '지급 대기' },
]

const stageLabel: Record<PipelineStage, string> = {
  proposed: '제안 보냄', accepted: '수락 완료', submitted: '영상 제출', verified: '검증 완료', paid: '지급 완료',
}

function shortWallet(wallet: string) {
  return `${wallet.slice(0, 5)}…${wallet.slice(-4)}`
}

function CreatorCard({ creator, onSelect }: { creator: PipelineCreator; onSelect: (creator: PipelineCreator) => void }) {
  return (
    <button className="pipeline-card" onClick={() => onSelect(creator)}>
      <span className={`pipeline-state state-${creator.stage}`}>{stageLabel[creator.stage]}</span>
      <strong>{creator.creatorName}</strong>
      <span className="channel-name">{creator.youtubeChannel}</span>
      <div className="card-payment"><span>제안 금액</span><b>{creator.offeredAmountUsdc} USDC</b></div>
      <small>{creator.nextAction} →</small>
    </button>
  )
}

export function CreatorPipeline({ onManage }: { onManage: () => void }) {
  const [data, setData] = useState<CreatorFlow2Pipeline | null>(null)
  const [selected, setSelected] = useState<PipelineCreator | null>(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    setMessage('')
    try {
      setData(await getCreatorFlow2Pipeline())
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '파이프라인을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const counts = useMemo(() => columns.map(({ stage }) => data?.creators.filter((creator) => creator.stage === stage).length ?? 0), [data])
  const totalOffered = useMemo(() => data?.creators.reduce((sum, creator) => sum + Number(creator.offeredAmountUsdc), 0) ?? 0, [data])

  return (
    <section className="pipeline-page">
      <header className="pipeline-heading">
        <div>
          <span className="kicker">CREATORFLOW2 · SOLANA DEVNET</span>
          <h1>크리에이터 진행 현황</h1>
          <p>브랜드 AI가 제안하고, 시스템이 영상과 지급을 검증합니다.</p>
        </div>
        <div className="heading-actions">
          <button className="secondary-button" onClick={() => void refresh()}>새로고침</button>
          <button className="primary-button" onClick={onManage}>AI · 지갑 설정</button>
        </div>
      </header>

      <div className="campaign-strip">
        <div><span>캠페인</span><strong>{data?.campaign.title ?? 'CreatorFlow 소개 영상'}</strong></div>
        <div><span>크리에이터</span><strong>{data?.creators.length ?? 0}명</strong></div>
        <div><span>제안 합계</span><strong>{totalOffered.toFixed(2)} USDC</strong></div>
        <div><span>AI 일일 한도</span><strong>{data?.campaign.dailyAiCapUsdc ?? '0.10'} USDC</strong></div>
      </div>

      <div className="ai-system-bar">
        <div><span className="actor-dot ai-dot">AI</span><p><strong>브랜드 AI</strong> 크리에이터 분석 · 금액 제안 · 지급 서명</p></div>
        <div><span className="actor-dot system-dot">S</span><p><strong>시스템</strong> YouTube · 예산 · 중복 지급 · Solana 거래 검증</p></div>
      </div>

      {loading ? <div className="pipeline-loading">진행 현황을 불러오는 중…</div> : null}
      {message ? <p className="api-message" role="status">{message}</p> : null}
      {!loading && !message ? (
        <div className="pipeline-board">
          {columns.map((column, index) => {
            const creators = data?.creators.filter((creator) => creator.stage === column.stage) ?? []
            return (
              <section className="pipeline-column" key={column.stage}>
                <header><span>{index + 1}</span><strong>{column.label}</strong><b>{counts[index]}</b></header>
                <div className="column-cards">
                  {creators.map((creator) => <CreatorCard creator={creator} onSelect={setSelected} key={creator.creatorId} />)}
                  {!creators.length ? <div className="empty-column">{column.empty}</div> : null}
                </div>
              </section>
            )
          })}
        </div>
      ) : null}

      <div className="simple-flow-note">
        <strong>크리에이터가 하는 일은 두 가지뿐입니다.</strong>
        <span>① 제안 수락&nbsp;&nbsp; ② YouTube 주소 제출</span>
      </div>
      <p className="board-hint">모바일에서는 진행 단계를 옆으로 넘겨 확인할 수 있습니다.</p>

      {selected ? (
        <div className="detail-backdrop" role="presentation" onMouseDown={() => setSelected(null)}>
          <aside className="creator-detail" role="dialog" aria-modal="true" aria-label={`${selected.creatorName} 상세`} onMouseDown={(event) => event.stopPropagation()}>
            <button className="detail-close" onClick={() => setSelected(null)} aria-label="닫기">×</button>
            <span className={`pipeline-state state-${selected.stage}`}>{stageLabel[selected.stage]}</span>
            <h2>{selected.creatorName}</h2>
            <p>{selected.youtubeChannel}</p>
            <dl>
              <div><dt>제안 금액</dt><dd>{selected.offeredAmountUsdc} USDC</dd></div>
              <div><dt>AI 적합도</dt><dd>{selected.fitScore}점</dd></div>
              <div><dt>다음 단계</dt><dd>{selected.nextAction}</dd></div>
              <div><dt>지급 지갑</dt><dd>{shortWallet(selected.creatorWallet)}</dd></div>
            </dl>
            {selected.video ? <a className="primary-button detail-link" href={selected.video.youtubeUrl} target="_blank" rel="noreferrer">YouTube 영상 보기</a> : null}
            {selected.transactionSignature ? <a className="secondary-button detail-link" href={`https://explorer.solana.com/tx/${selected.transactionSignature}?cluster=devnet`} target="_blank" rel="noreferrer">Solana 지급 확인</a> : null}
            <small>고급 정보는 이 화면에만 표시됩니다.</small>
          </aside>
        </div>
      ) : null}
    </section>
  )
}
