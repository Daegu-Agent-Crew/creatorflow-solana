import { useEffect, useState } from 'react'
import './App.css'
import { RegistrationForm } from './RegistrationForm'
import { NegotiationPanel } from './NegotiationPanel'
import { listAgents, listAuditEvents, type AuditEvent, type PublicAgent } from './api'

type View = 'campaign' | 'agents' | 'activity'

const milestones = [
  { label: '계약 승인', detail: '양쪽 에이전트가 조건을 승인했습니다.', amount: '0.02 USDC', state: '완료' },
  { label: '영상 공개', detail: 'YouTube 영상 주소를 기다리고 있습니다.', amount: '0.03 USDC', state: '대기' },
  { label: '성과 확인', detail: '공개 조회수 100회 달성 시 지급합니다.', amount: '0.01 USDC', state: '잠김' },
]

const eventLabels: Record<string, string> = {
  'agent.registered': '에이전트 등록',
  'campaign.created': '캠페인 생성',
  'offer.created': '조건 제안',
  'offer.countered': '수정 조건 제안',
  'offer.rejected': '제안 거절',
  'deal.accepted': '계약 수락',
}

function shortWallet(wallet: string) {
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`
}

function eventProof(event: AuditEvent) {
  if (event.campaignTitle) return event.campaignTitle
  if (event.agentRole === 'brand') return '브랜드'
  if (event.agentRole === 'creator') return '크리에이터'
  return '감사 기록'
}

function WalletStatus() {
  return (
    <div className="wallet-status" title="테스트 자금 지갑">
      <span className="status-dot" aria-hidden="true" />
      <span>FWmG…EB5i</span>
      <strong>20.00 USDC</strong>
    </div>
  )
}

function CampaignView({ onRegister }: { onRegister: () => void }) {
  return (
    <section className="page-stack">
      <header className="page-heading">
        <div>
          <span className="kicker">SOLANA DEVNET · 데모</span>
          <h1>YouTube 캠페인 운영</h1>
          <p>두 OpenClaw 에이전트가 협상하고, 공개된 영상과 지급 기록을 함께 검증합니다.</p>
        </div>
        <button className="primary-button" onClick={onRegister}>에이전트 등록</button>
      </header>

      <div className="summary-bar" aria-label="캠페인 요약">
        <div><span>현재 단계</span><strong>영상 공개 대기</strong></div>
        <div><span>예산 한도</span><strong>0.10 USDC</strong></div>
        <div><span>등록 에이전트</span><strong>2개</strong></div>
        <div><span>네트워크</span><strong>Solana Devnet</strong></div>
      </div>

      <div className="main-grid">
        <article className="workspace">
          <div className="section-heading">
            <div>
              <span className="kicker">진행 중인 캠페인</span>
              <h2>CreatorFlow 소개 영상</h2>
            </div>
            <span className="state-badge">진행 중</span>
          </div>

          <dl className="campaign-facts">
            <div><dt>결과물</dt><dd>YouTube 브랜드 영상</dd></div>
            <div><dt>목표</dt><dd>공개 조회수 100회</dd></div>
            <div><dt>마감</dt><dd>2026년 7월 30일</dd></div>
          </dl>

          <div className="timeline">
            {milestones.map((item, index) => (
              <div className={`timeline-row step-${index + 1}`} key={item.label}>
                <span className="step-number">{index + 1}</span>
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                </div>
                <div className="step-meta"><strong>{item.amount}</strong><span>{item.state}</span></div>
              </div>
            ))}
          </div>
        </article>

        <aside className="side-panel">
          <span className="kicker">지금 할 일</span>
          <h2>크리에이터 영상을 제출하세요</h2>
          <p>공개된 YouTube 영상 주소를 등록하면 채널 소유권과 공개 상태를 확인합니다.</p>
          <label className="field">
            <span>YouTube 영상 주소</span>
            <input type="url" placeholder="https://youtube.com/watch?v=…" />
          </label>
          <button className="primary-button full-button">영상 확인 시작</button>
          <p className="helper-text">지갑 개인키는 웹페이지로 전송하지 않습니다.</p>
          <div className="allowance-line">
            <div><span>지급 허용 한도</span><strong>0.08 / 0.10 USDC</strong></div>
            <progress value="0.08" max="0.1">80%</progress>
          </div>
        </aside>
      </div>
      <NegotiationPanel />
    </section>
  )
}

function AgentDirectory({ refreshKey }: { refreshKey: number }) {
  const [agents, setAgents] = useState<PublicAgent[]>([])
  const [message, setMessage] = useState('')

  useEffect(() => {
    listAgents()
      .then((result) => setAgents(result.agents))
      .catch((error) => setMessage(error instanceof Error ? error.message : '에이전트 목록을 불러오지 못했습니다.'))
  }, [refreshKey])

  return (
    <article className="agent-directory">
      <div className="section-heading"><div><span className="kicker">D1 등록 현황</span><h2>등록된 에이전트</h2></div><span className="state-badge muted-badge">{agents.length}명</span></div>
      {agents.length ? <div className="agent-cards">{agents.map((agent) => (
        <div className="agent-card" key={agent.agentId}>
          <span className={`agent-role ${agent.role}`}>{agent.role === 'brand' ? '브랜드' : '크리에이터'}</span>
          <strong>{agent.name}</strong>
          <code>{agent.agentId}</code>
          <span>{shortWallet(agent.wallet)}</span>
          <time>{new Date(agent.createdAt).toLocaleString('ko-KR')}</time>
        </div>
      ))}</div> : <p className="empty-note">아직 등록된 에이전트가 없습니다.</p>}
      {message ? <p className="api-message" role="status">{message}</p> : null}
    </article>
  )
}

function AgentsView() {
  const [refreshKey, setRefreshKey] = useState(0)
  return (
    <section className="page-stack narrow-page">
      <header className="page-heading">
        <div>
          <span className="kicker">지갑 서명으로 본인 확인</span>
          <h1>에이전트 등록</h1>
          <p>Agent ID는 서버가 만들고, 이름과 역할은 등록할 OpenClaw 에이전트가 선택합니다.</p>
        </div>
      </header>

      <RegistrationForm onRegistered={() => setRefreshKey((current) => current + 1)} />
      <AgentDirectory refreshKey={refreshKey} />
    </section>
  )
}

function ActivityView() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [message, setMessage] = useState('')

  useEffect(() => {
    listAuditEvents()
      .then((result) => setEvents(result.events))
      .catch((error) => setMessage(error instanceof Error ? error.message : '활동 기록을 불러오지 못했습니다.'))
  }, [])

  return (
    <section className="page-stack">
      <header className="page-heading">
        <div><span className="kicker">검증 가능한 실행 기록</span><h1>활동 기록</h1><p>에이전트 결정, 정책 검사, YouTube 확인, Solana 서명을 시간순으로 모읍니다.</p></div>
        <button className="secondary-button">기록 내보내기</button>
      </header>
      <article className="activity-list">
        <div className="activity-row activity-head"><span>시각</span><span>실행 주체</span><span>활동</span><span>증거</span></div>
        {events.map((event) => (
          <div className="activity-row" key={event.eventId}>
            <time>{new Date(event.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</time>
            <strong>{event.agentName ?? '시스템'}</strong>
            <span>{eventLabels[event.eventType] ?? event.eventType}</span>
            <span className="proof">{eventProof(event)}</span>
          </div>
        ))}
      </article>
      {!events.length && !message ? <p className="empty-note">아직 활동 기록이 없습니다.</p> : null}
      {message ? <p className="api-message" role="status">{message}</p> : null}
    </section>
  )
}

function App() {
  const [view, setView] = useState<View>('campaign')
  const navItems: Array<{ id: View; label: string }> = [
    { id: 'campaign', label: '캠페인' },
    { id: 'agents', label: '에이전트' },
    { id: 'activity', label: '활동 기록' },
  ]

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView('campaign')} aria-label="CreatorFlow 캠페인으로 이동">
          <span className="brand-mark">CF</span><span>CreatorFlow<small>에이전트 캠페인</small></span>
        </button>
        <nav aria-label="주요 메뉴">
          {navItems.map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>{item.label}</button>)}
        </nav>
        <WalletStatus />
      </header>
      <main>
        {view === 'campaign' ? <CampaignView onRegister={() => setView('agents')} /> : null}
        {view === 'agents' ? <AgentsView /> : null}
        {view === 'activity' ? <ActivityView /> : null}
      </main>
      <footer><span>CreatorFlow · Solana AI Agentic Hackathon</span><span>Devnet 테스트 자산은 실제 가치가 없습니다.</span></footer>
    </div>
  )
}

export default App
