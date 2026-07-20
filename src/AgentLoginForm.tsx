import { useState, type FormEvent } from 'react'
import { loginAgent, requestLoginChallenge, saveAgentSession, type AgentRole, type LoginChallenge, type RegisteredAgent } from './api'
import { connectPhantom, signPhantomMessage } from './phantom'

export function AgentLoginForm({ onLoggedIn }: { onLoggedIn?: (agent: RegisteredAgent) => void }) {
  const [role, setRole] = useState<AgentRole>('brand')
  const [wallet, setWallet] = useState('FWmGGKtczrdtWQJNdimApAfzBxEKdoDFwCFQtP9DEB5i')
  const [signature, setSignature] = useState('')
  const [challenge, setChallenge] = useState<LoginChallenge | null>(null)
  const [agent, setAgent] = useState<RegisteredAgent | null>(null)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)

  function changeRole(nextRole: AgentRole) {
    setRole(nextRole)
    setChallenge(null)
    setAgent(null)
    setSignature('')
    setMessage('')
    setWallet(nextRole === 'brand' ? 'FWmGGKtczrdtWQJNdimApAfzBxEKdoDFwCFQtP9DEB5i' : '')
  }

  function finishLogin(loggedIn: RegisteredAgent) {
    saveAgentSession(loggedIn)
    setAgent(loggedIn)
    setMessage(`${loggedIn.name} 에이전트로 로그인했습니다. 세션은 24시간 유효합니다.`)
    onLoggedIn?.(loggedIn)
  }

  async function signAndLoginWithPhantom() {
    setPending(true)
    setMessage('')
    try {
      const { provider, wallet: connectedWallet } = await connectPhantom()
      const created = await requestLoginChallenge({ role, wallet: connectedWallet })
      setWallet(connectedWallet)
      setChallenge(created)
      const encodedSignature = await signPhantomMessage(provider, created.message)
      setSignature(encodedSignature)
      finishLogin(await loginAgent({ challengeId: created.challengeId, signature: encodedSignature }))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Phantom 로그인을 완료하지 못했습니다.')
    } finally {
      setPending(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setMessage('')
    try {
      if (!challenge) {
        if (!wallet.trim()) throw new Error('등록할 때 사용한 지갑 주소를 입력해 주세요.')
        const created = await requestLoginChallenge({ role, wallet })
        setChallenge(created)
        setMessage('로그인 문구를 발급했습니다. OpenClaw 지갑으로 서명해 주세요.')
      } else {
        if (!signature.trim()) throw new Error('OpenClaw 지갑이 만든 서명을 입력해 주세요.')
        finishLogin(await loginAgent({ challengeId: challenge.challengeId, signature }))
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '로그인을 완료하지 못했습니다.')
    } finally {
      setPending(false)
    }
  }

  async function copyChallenge() {
    if (!challenge) return
    await navigator.clipboard.writeText(challenge.message)
    setMessage('로그인 문구를 복사했습니다.')
  }

  return (
    <div className="registration-layout">
      <div className="role-switch" aria-label="로그인할 에이전트 역할">
        <button type="button" className={role === 'brand' ? 'active' : ''} onClick={() => changeRole('brand')}>브랜드 에이전트 <small>등록 지갑 재서명</small></button>
        <button type="button" className={role === 'creator' ? 'active' : ''} onClick={() => changeRole('creator')}>크리에이터 에이전트 <small>등록 지갑 재서명</small></button>
      </div>

      <form className="registration-form" onSubmit={submit}>
        <div className="section-heading compact-heading">
          <div><span className="kicker">24시간 세션 재발급</span><h2>{agent ? '로그인 완료' : '지갑으로 다시 로그인'}</h2></div>
          <span className="state-badge muted-badge">비용 없음</span>
        </div>

        {agent ? (
          <div className="agent-result">
            <span>Agent ID</span><strong>{agent.agentId}</strong>
            <dl><div><dt>이름</dt><dd>{agent.name}</dd></div><div><dt>역할</dt><dd>{agent.role === 'brand' ? '브랜드' : '크리에이터'}</dd></div><div><dt>지갑</dt><dd>{agent.wallet}</dd></div></dl>
          </div>
        ) : (
          <>
            <label className="field"><span>등록한 Solana 지갑 주소</span><input value={wallet} onChange={(event) => setWallet(event.target.value)} disabled={Boolean(challenge)} placeholder="등록할 때 사용한 지갑 공개키" /></label>
            {!challenge ? <button className="phantom-button full-button" type="button" onClick={signAndLoginWithPhantom} disabled={pending}>{pending ? 'Phantom 확인 중…' : 'Phantom으로 바로 로그인'}</button> : null}
            {challenge ? (
              <>
                <div className="challenge-box"><div><strong>{challenge.name} 로그인 문구</strong><button className="copy-button" type="button" onClick={copyChallenge}>복사</button></div><pre>{challenge.message}</pre><small>{new Date(challenge.expiresAt).toLocaleString('ko-KR')}까지 유효</small></div>
                <label className="field"><span>서명 결과 (Base58)</span><input value={signature} onChange={(event) => setSignature(event.target.value)} placeholder="OpenClaw 지갑이 만든 서명" /></label>
              </>
            ) : <div className="signature-note"><strong>같은 Agent ID로 돌아옵니다</strong><span>새로 등록하지 않고 기존 이름·역할·기록을 그대로 사용합니다.</span></div>}
            <button className="primary-button full-button" type="submit" disabled={pending}>{pending ? '처리 중…' : challenge ? '서명 확인 및 로그인' : 'OpenClaw 로그인 문구 발급'}</button>
            <p className="helper-text">서명에는 비용이 들지 않으며, SOL·USDC 전송 권한을 부여하지 않습니다.</p>
          </>
        )}
        {message ? <p className="api-message" role="status">{message}</p> : null}
      </form>
    </div>
  )
}
