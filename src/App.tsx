import { useEffect, useState, type FormEvent } from 'react'
import './App.css'
import { RegistrationForm } from './RegistrationForm'
import { AgentLoginForm } from './AgentLoginForm'
import { NegotiationPanel } from './NegotiationPanel'
import { getAgentSession, listAgents, listAuditEvents, listVideoSubmissions, requestVideoAttestationChallenge, requestVideoSubmissionChallenge, submitSignedVideo, type AuditEvent, type PublicAgent, type VideoSubmission, type VideoSubmissionChallenge } from './api'
import { connectPhantom, signPhantomMessage } from './phantom'
import { PaymentPanel } from './PaymentPanel'
import { CreatorPipeline } from './CreatorPipeline'
import { WalletDelegationPanel } from './WalletDelegationPanel'
import { CreatorInvitePage } from './CreatorInvitePage'
import { WalletRecoveryPanel } from './WalletRecoveryPanel'

type View = 'campaign' | 'agents' | 'activity'

const milestones = [
  { label: '계약 승인', detail: '양쪽 에이전트가 조건을 승인했습니다.', amount: '0.02 USDC', state: '완료' },
  { label: '영상 공개', detail: 'YouTube 영상 주소를 기다리고 있습니다.', amount: '0.03 USDC', state: '대기' },
  { label: '성과 확인', detail: '공개 조회수 100회 달성 시 지급합니다.', amount: '0.01 USDC', state: '잠김' },
]

const eventLabels: Record<string, string> = {
  'agent.registered': '에이전트 등록',
  'agent.logged_in': '지갑 재로그인',
  'campaign.created': '캠페인 생성',
  'offer.created': '조건 제안',
  'offer.countered': '수정 조건 제안',
  'offer.rejected': '제안 거절',
  'deal.accepted': '계약 수락',
  'youtube.video_registered': 'YouTube 영상 등록',
  'youtube.video_attested': '영상 제출 서명',
  'payment.requested': 'USDC 지급 요청',
  'payment.confirmed': 'USDC 지급 완료',
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

// Legacy single-creator screen kept temporarily for backward-compatible deep links.
export function CampaignView({ onRegister }: { onRegister: () => void }) {
  const [youtubeUrl, setYoutubeUrl] = useState('https://youtu.be/I96Mwbm7Tp0')
  const [videos, setVideos] = useState<VideoSubmission[]>([])
  const [videoMessage, setVideoMessage] = useState('')
  const [videoPending, setVideoPending] = useState(false)
  const [submissionChallenge, setSubmissionChallenge] = useState<VideoSubmissionChallenge | null>(null)
  const [submissionSignature, setSubmissionSignature] = useState('')
  const latestVideo = videos[0]

  useEffect(() => {
    listVideoSubmissions()
      .then((result) => setVideos(result.videos))
      .catch((error) => setVideoMessage(error instanceof Error ? error.message : '등록 영상을 불러오지 못했습니다.'))
  }, [])

  function finishVideoSubmission(registered: VideoSubmission) {
    setVideos((current) => [registered, ...current.filter((video) => video.submissionId !== registered.submissionId)])
    setSubmissionChallenge(null)
    setSubmissionSignature('')
    setVideoMessage(`제출 완료: ${registered.title}`)
  }

  async function submitVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const session = getAgentSession()
    if (!session) {
      setVideoMessage('먼저 에이전트 탭에서 크리에이터 지갑으로 로그인해 주세요.')
      return
    }
    if (session.role !== 'creator') {
      setVideoMessage('현재 브랜드 에이전트로 로그인되어 있습니다. 크리에이터 에이전트로 다시 로그인해 주세요.')
      return
    }
    setVideoPending(true)
    setVideoMessage('')
    try {
      if (submissionChallenge) {
        if (!submissionSignature.trim()) throw new Error('OpenClaw 지갑이 만든 서명을 입력해 주세요.')
        finishVideoSubmission(await submitSignedVideo(session, submissionChallenge.challengeId, submissionSignature))
        return
      }

      const challenge = latestVideo && !latestVideo.creatorSigned
        ? await requestVideoAttestationChallenge(session, latestVideo.submissionId)
        : await requestVideoSubmissionChallenge(session, youtubeUrl)
      setSubmissionChallenge(challenge)
      try {
        const { provider, wallet } = await connectPhantom()
        if (wallet !== session.wallet) throw new Error('로그인한 크리에이터 지갑과 Phantom 지갑이 다릅니다.')
        const signature = await signPhantomMessage(provider, challenge.message)
        setSubmissionSignature(signature)
        finishVideoSubmission(await submitSignedVideo(session, challenge.challengeId, signature))
      } catch (error) {
        setVideoMessage(`${error instanceof Error ? error.message : 'Phantom 서명을 완료하지 못했습니다.'} OpenClaw을 사용한다면 아래 문구에 서명해 주세요.`)
      }
    } catch (error) {
      setVideoMessage(error instanceof Error ? error.message : '영상을 등록하지 못했습니다.')
    } finally {
      setVideoPending(false)
    }
  }

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
        <div><span>현재 단계</span><strong>{latestVideo ? '성과 확인 대기' : '영상 공개 대기'}</strong></div>
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
            {milestones.map((item, index) => {
              const videoComplete = index === 1 && latestVideo
              return (
              <div className={`timeline-row step-${index + 1}`} key={item.label}>
                <span className="step-number">{index + 1}</span>
                <div>
                  <strong>{item.label}</strong>
                  <p>{videoComplete ? `${latestVideo.title} 공개 확인 완료` : item.detail}</p>
                </div>
                <div className="step-meta"><strong>{item.amount}</strong><span>{videoComplete ? '완료' : item.state}</span></div>
              </div>
              )
            })}
          </div>
        </article>

        <aside className="side-panel">
          <span className="kicker">지금 할 일</span>
          <h2>{latestVideo ? '등록된 크리에이터 영상' : '크리에이터 영상을 제출하세요'}</h2>
          {latestVideo ? (
            <div className="video-result">
              {latestVideo.thumbnailUrl ? <img src={latestVideo.thumbnailUrl} alt={`${latestVideo.title} 썸네일`} /> : null}
              <strong>{latestVideo.title}</strong>
              <span>{latestVideo.channelTitle} · {latestVideo.creatorName}</span>
              <a href={latestVideo.youtubeUrl} target="_blank" rel="noreferrer">YouTube에서 보기</a>
              <small>공개 영상 확인 완료 · 채널 OAuth 확인 전</small>
            </div>
          ) : <p>공개된 YouTube 영상을 확인한 뒤 캠페인과 크리에이터 Agent ID에 연결합니다.</p>}
          {!latestVideo || !latestVideo.creatorSigned ? <form onSubmit={submitVideo}>
            {!latestVideo ? <label className="field">
              <span>YouTube 영상 주소</span>
              <input type="url" value={youtubeUrl} onChange={(event) => { setYoutubeUrl(event.target.value); setSubmissionChallenge(null); setSubmissionSignature('') }} disabled={Boolean(submissionChallenge)} placeholder="https://youtube.com/watch?v=…" required />
            </label> : null}
            {submissionChallenge ? (
              <>
                <div className="challenge-box simple-signature"><div><strong>대구루가 확인할 내용</strong><button className="copy-button" type="button" onClick={() => navigator.clipboard.writeText(submissionChallenge.message)}>복사</button></div><pre>{submissionChallenge.message}</pre></div>
                <label className="field"><span>OpenClaw 서명 결과</span><input value={submissionSignature} onChange={(event) => setSubmissionSignature(event.target.value)} placeholder="Base58 서명" /></label>
              </>
            ) : null}
            <button className="primary-button full-button" disabled={videoPending}>{videoPending ? '처리 중…' : submissionChallenge ? '서명 확인 및 제출' : latestVideo ? '대구루 지갑으로 제출 확인' : '지갑으로 서명하고 제출'}</button>
          </form> : <p className="signed-note">✓ 대구루 지갑 제출 서명 완료</p>}
          {videoMessage ? <p className="api-message" role="status">{videoMessage}</p> : null}
          {!getAgentSession() ? <button className="secondary-button full-button login-helper" onClick={onRegister}>크리에이터 로그인</button> : null}
          <p className="helper-text">영상 제출만 승인합니다. 결제 권한은 없으며 지갑 개인키는 전송하지 않습니다.</p>
          <div className="allowance-line">
            <div><span>지급 허용 한도</span><strong>0.08 / 0.10 USDC</strong></div>
            <progress value="0.08" max="0.1">80%</progress>
          </div>
        </aside>
      </div>
      <PaymentPanel video={latestVideo} onLogin={onRegister} />
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
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  return (
    <section className="page-stack narrow-page">
      <header className="page-heading">
        <div>
          <span className="kicker">지갑 서명으로 본인 확인</span>
          <h1>{authMode === 'login' ? '에이전트 로그인' : '에이전트 등록'}</h1>
          <p>{authMode === 'login' ? '등록한 지갑으로 다시 서명하면 기존 Agent ID의 24시간 세션을 새로 받습니다.' : 'Agent ID는 서버가 만들고, 이름과 역할은 등록할 OpenClaw 에이전트가 선택합니다.'}</p>
        </div>
      </header>

      <div className="auth-mode-switch" aria-label="로그인 또는 새 등록">
        <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>다시 로그인</button>
        <button className={authMode === 'register' ? 'active' : ''} onClick={() => setAuthMode('register')}>새 에이전트 등록</button>
      </div>
      {authMode === 'login'
        ? <AgentLoginForm onLoggedIn={() => setRefreshKey((current) => current + 1)} />
        : <RegistrationForm onRegistered={() => setRefreshKey((current) => current + 1)} />}
      <WalletDelegationPanel refreshKey={refreshKey} />
      <WalletRecoveryPanel />
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
  const inviteToken = new URLSearchParams(window.location.search).get('invite')
  const [view, setView] = useState<View>('campaign')
  const navItems: Array<{ id: View; label: string }> = [
    { id: 'campaign', label: '캠페인' },
    { id: 'agents', label: '에이전트' },
    { id: 'activity', label: '활동 기록' },
  ]

  if (inviteToken) return <CreatorInvitePage token={inviteToken} />

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
        {view === 'campaign' ? <CreatorPipeline onManage={() => setView('agents')} /> : null}
        {view === 'agents' ? <AgentsView /> : null}
        {view === 'activity' ? <ActivityView /> : null}
      </main>
      <footer><span>CreatorFlow · Solana AI Agentic Hackathon</span><span>Devnet 테스트 자산은 실제 가치가 없습니다.</span></footer>
    </div>
  )
}

export default App
