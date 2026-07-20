import { useState } from 'react'
import './App.css'

type View = 'overview' | 'brand' | 'creator' | 'audit'

const milestones = [
  { label: 'Deal accepted', amount: '0.02', state: 'Ready', tone: 'ready' },
  { label: 'Video public', amount: '0.03', state: 'Waiting', tone: 'waiting' },
  { label: 'KPI verified', amount: '0.01', state: 'Locked', tone: 'locked' },
]

const events = [
  { time: '14:32:08', actor: 'Brand Agent', action: 'Campaign brief created', proof: 'Gemini run #CF-201' },
  { time: '14:33:41', actor: 'Creator Agent', action: 'Counter offer submitted', proof: 'Wallet verified' },
  { time: '14:34:12', actor: 'Brand Agent', action: 'Offer accepted', proof: 'Policy passed' },
  { time: '14:34:29', actor: 'Solana Devnet', action: 'Deposit queued · 0.02 USDC', proof: 'Awaiting delegate' },
]

function Wallet({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'wallet wallet-compact' : 'wallet'}>
      <span className="wallet-dot" aria-hidden="true" />
      <span>{compact ? 'FWmG…EB5i' : 'Treasury · FWmG…EB5i'}</span>
      <strong>20.00 USDC</strong>
    </div>
  )
}

function Overview() {
  return (
    <>
      <section className="hero-panel">
        <div>
          <span className="eyebrow">Agentic creator commerce · Solana Devnet</span>
          <h1>From a creator deal<br />to verifiable payment.</h1>
          <p className="hero-copy">
            Gemini-powered OpenClaw agents negotiate a YouTube campaign, verify delivery,
            and release Devnet USDC inside a strict delegated allowance.
          </p>
          <div className="hero-actions">
            <button className="primary">Launch campaign</button>
            <button className="secondary">View agent protocol</button>
          </div>
        </div>
        <div className="flow-card" aria-label="Campaign flow status">
          <div className="flow-topline"><span>LIVE WORKFLOW</span><span className="live-dot">DEVNET</span></div>
          <div className="flow-step done"><span>01</span><div><strong>Negotiate</strong><small>Offer accepted by both agents</small></div><b>✓</b></div>
          <div className="flow-line active" />
          <div className="flow-step active"><span>02</span><div><strong>Publish</strong><small>Waiting for YouTube URL</small></div><b>→</b></div>
          <div className="flow-line" />
          <div className="flow-step"><span>03</span><div><strong>Verify & pay</strong><small>Public status + view KPI</small></div><b>○</b></div>
        </div>
      </section>

      <section className="metric-grid" aria-label="Service metrics">
        <article><span>Campaign budget</span><strong>0.10 <small>USDC</small></strong><em>delegated ceiling</em></article>
        <article><span>Active agents</span><strong>2</strong><em>Gemini + OpenClaw</em></article>
        <article><span>Milestones</span><strong>1 <small>/ 3</small></strong><em>deal accepted</em></article>
        <article><span>Network</span><strong className="network-value">Solana</strong><em>Devnet verified</em></article>
      </section>

      <section className="workspace-grid">
        <article className="panel campaign-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">ACTIVE CAMPAIGN</span><h2>CreatorFlow launch video</h2></div>
            <span className="status-pill">IN PROGRESS</span>
          </div>
          <div className="campaign-meta">
            <div><span>Deliverable</span><strong>YouTube branded video</strong></div>
            <div><span>Target KPI</span><strong>100 public views</strong></div>
            <div><span>Deadline</span><strong>30 Jul 2026</strong></div>
          </div>
          <div className="milestones">
            {milestones.map((item, index) => (
              <div className="milestone" key={item.label}>
                <span className={`milestone-index ${item.tone}`}>{index + 1}</span>
                <div><strong>{item.label}</strong><small>{item.amount} USDC</small></div>
                <span className={`milestone-state ${item.tone}`}>{item.state}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="panel agent-panel">
          <div className="panel-heading"><div><span className="eyebrow">AGENT CREW</span><h2>Autonomous, wallet-bound</h2></div></div>
          <div className="agent-row">
            <span className="agent-avatar brand-avatar">B</span>
            <div><strong>Brand Negotiator</strong><small>OpenClaw · Gemini</small></div>
            <span className="verified">● VERIFIED</span>
          </div>
          <div className="agent-row">
            <span className="agent-avatar creator-avatar">C</span>
            <div><strong>Creator Studio</strong><small>OpenClaw · Gemini</small></div>
            <span className="verified">● VERIFIED</span>
          </div>
          <div className="allowance">
            <div><span>Delegate allowance</span><strong>0.10 USDC</strong></div>
            <div className="progress"><i /></div>
            <small>0.02 committed · 0.08 remaining</small>
          </div>
        </article>
      </section>
    </>
  )
}

function AgentView({ role }: { role: 'brand' | 'creator' }) {
  const isBrand = role === 'brand'
  return (
    <section className="role-layout">
      <article className="role-intro">
        <span className="eyebrow">{isBrand ? 'BRAND AGENT CONSOLE' : 'CREATOR AGENT CONSOLE'}</span>
        <h1>{isBrand ? 'Negotiate within policy.' : 'Create, submit, get paid.'}</h1>
        <p>{isBrand
          ? 'Review campaign constraints, approve an offer, and release payments only after verified events.'
          : 'Connect a wallet and YouTube channel, negotiate the deliverable, then submit the published video.'}</p>
        <div className="identity-card">
          <span className={`agent-avatar ${isBrand ? 'brand-avatar' : 'creator-avatar'}`}>{isBrand ? 'B' : 'C'}</span>
          <div><span>Agent identity</span><strong>{isBrand ? 'Brand Negotiator' : 'Creator Studio'}</strong><small>Wallet signature required · Gemini active</small></div>
          <span className="verified">● VERIFIED</span>
        </div>
      </article>
      <article className="panel action-panel">
        <div className="panel-heading"><div><span className="eyebrow">NEXT ACTION</span><h2>{isBrand ? 'Review accepted offer' : 'Submit YouTube delivery'}</h2></div><span className="step-label">STEP 2 OF 3</span></div>
        {isBrand ? (
          <div className="offer-box">
            <div><span>Deposit</span><strong>0.02 USDC</strong></div><div><span>On public</span><strong>0.03 USDC</strong></div><div><span>KPI bonus</span><strong>0.01 USDC</strong></div>
          </div>
        ) : (
          <label className="url-field"><span>YouTube video URL</span><input placeholder="https://youtube.com/watch?v=…" /><small>Channel and publication status will be verified by the Worker.</small></label>
        )}
        <div className="policy-list">
          <div><span>✓</span><p><strong>Wallet identity</strong><small>Challenge signature verified</small></p></div>
          <div><span>✓</span><p><strong>Campaign state</strong><small>Offer accepted by both agents</small></p></div>
          <div><span>{isBrand ? '✓' : '○'}</span><p><strong>{isBrand ? 'Allowance available' : 'YouTube ownership'}</strong><small>{isBrand ? '0.08 USDC remains' : 'Checked after URL submission'}</small></p></div>
        </div>
        <button className="primary full-width">{isBrand ? 'Prepare deposit transaction' : 'Verify and submit video'}</button>
        <p className="safety-note">No private keys are sent to CreatorFlow. Signing happens inside the OpenClaw wallet tool.</p>
      </article>
    </section>
  )
}

function AuditView() {
  return (
    <section className="audit-view">
      <div className="audit-header"><div><span className="eyebrow">VERIFIABLE EXECUTION</span><h1>Every decision leaves evidence.</h1><p>Agent actions, policy checks, YouTube snapshots, and Solana signatures share one campaign timeline.</p></div><button className="secondary">Export evidence</button></div>
      <article className="panel audit-panel">
        <div className="audit-table audit-table-head"><span>TIME</span><span>ACTOR</span><span>EVENT</span><span>PROOF</span></div>
        {events.map((event) => <div className="audit-table" key={event.time}><code>{event.time}</code><strong>{event.actor}</strong><span>{event.action}</span><span className="proof-chip">{event.proof}</span></div>)}
      </article>
    </section>
  )
}

function App() {
  const [view, setView] = useState<View>('overview')
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView('overview')}><span className="brand-mark">CF</span><span>CreatorFlow<small>AGENTIC COMMERCE</small></span></button>
        <nav aria-label="Primary navigation">
          {(['overview', 'brand', 'creator', 'audit'] as View[]).map((item) => <button key={item} className={view === item ? 'active' : ''} onClick={() => setView(item)}>{item === 'audit' ? 'Audit log' : item}</button>)}
        </nav>
        <Wallet compact />
      </header>
      <main>
        {view === 'overview' && <Overview />}
        {view === 'brand' && <AgentView role="brand" />}
        {view === 'creator' && <AgentView role="creator" />}
        {view === 'audit' && <AuditView />}
      </main>
      <footer><span>CreatorFlow · Solana AI Agentic Hackathon</span><span>DEVNET ONLY · TEST ASSETS HAVE NO REAL VALUE</span></footer>
    </div>
  )
}

export default App
