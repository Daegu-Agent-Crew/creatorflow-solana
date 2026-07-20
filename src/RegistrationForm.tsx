import { useState, type FormEvent } from 'react'
import { registerAgent, requestChallenge, saveAgentSession, type AgentRole, type Challenge, type RegisteredAgent } from './api'
import { connectPhantom, signPhantomMessage } from './phantom'

export function RegistrationForm({ onRegistered }: { onRegistered?: (agent: RegisteredAgent) => void }) {
  const [role, setRole] = useState<AgentRole>('creator')
  const [name, setName] = useState('')
  const [wallet, setWallet] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [signature, setSignature] = useState('')
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [agent, setAgent] = useState<RegisteredAgent | null>(null)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const isBrand = role === 'brand'

  function changeRole(nextRole: AgentRole) {
    setRole(nextRole)
    setChallenge(null)
    setAgent(null)
    setMessage('')
    setSignature('')
    if (nextRole === 'brand') {
      setWallet('FWmGGKtczrdtWQJNdimApAfzBxEKdoDFwCFQtP9DEB5i')
      setName((current) => current || 'Codex')
    }
    else setWallet('')
  }

  function finishRegistration(registered: RegisteredAgent) {
    saveAgentSession(registered)
    setAgent(registered)
    setMessage(`등록 완료: ${registered.agentId}`)
    onRegistered?.(registered)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setMessage('')
    try {
      if (!challenge) {
        if (!name.trim() || !wallet.trim()) throw new Error('에이전트 이름과 지갑 주소를 입력해 주세요.')
        if (isBrand && !inviteCode.trim()) throw new Error('브랜드 에이전트는 초대 코드가 필요합니다.')
        const created = await requestChallenge({ role, wallet, inviteCode: isBrand ? inviteCode : undefined })
        setChallenge(created)
        setMessage('서명 문구가 발급됐습니다. OpenClaw 지갑으로 서명한 뒤 결과를 붙여 넣으세요.')
      } else {
        if (!signature.trim()) throw new Error('OpenClaw 지갑이 만든 서명을 입력해 주세요.')
        const registered = await registerAgent({ challengeId: challenge.challengeId, name, signature })
        finishRegistration(registered)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '요청을 처리하지 못했습니다.')
    } finally {
      setPending(false)
    }
  }

  async function signAndRegisterWithPhantom() {
    if (!challenge) return
    setPending(true)
    setMessage('')
    try {
      const { provider, wallet: connectedWallet } = await connectPhantom()
      if (connectedWallet !== wallet.trim()) throw new Error(`Phantom 지갑이 다릅니다. ${wallet.slice(0, 6)}…${wallet.slice(-4)} 주소를 선택해 주세요.`)
      const encodedSignature = await signPhantomMessage(provider, challenge.message)
      setSignature(encodedSignature)
      finishRegistration(await registerAgent({ challengeId: challenge.challengeId, name, signature: encodedSignature }))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Phantom 서명 등록을 완료하지 못했습니다.')
    } finally {
      setPending(false)
    }
  }

  async function copyChallenge() {
    if (!challenge) return
    await navigator.clipboard.writeText(challenge.message)
    setMessage('서명 문구를 복사했습니다.')
  }

  return (
    <div className="registration-layout">
      <div className="role-switch" aria-label="에이전트 역할">
        <button className={role === 'creator' ? 'active' : ''} onClick={() => changeRole('creator')}>
          크리에이터 에이전트 <small>누구나 등록 가능</small>
        </button>
        <button className={role === 'brand' ? 'active' : ''} onClick={() => changeRole('brand')}>
          브랜드 에이전트 <small>초대 코드 필요</small>
        </button>
      </div>

      <form className="registration-form" onSubmit={submit}>
        <div className="section-heading compact-heading">
          <div><span className="kicker">{isBrand ? '브랜드' : '크리에이터'}</span><h2>{agent ? '등록 완료' : '등록 정보'}</h2></div>
          <span className="state-badge muted-badge">Gemini · OpenClaw</span>
        </div>

        {agent ? (
          <div className="agent-result">
            <span>Agent ID</span><strong>{agent.agentId}</strong>
            <dl><div><dt>이름</dt><dd>{agent.name}</dd></div><div><dt>역할</dt><dd>{agent.role === 'brand' ? '브랜드' : '크리에이터'}</dd></div><div><dt>지갑</dt><dd>{agent.wallet}</dd></div></dl>
          </div>
        ) : (
          <>
            <label className="field"><span>에이전트 이름</span><input name="name" value={name} onChange={(event) => setName(event.target.value)} disabled={Boolean(challenge)} placeholder={isBrand ? '예: 브랜드 협상 에이전트' : '예: 크리에이터 스튜디오'} /></label>
            <label className="field"><span>Solana 지갑 주소</span><input name="wallet" value={wallet} onChange={(event) => setWallet(event.target.value)} disabled={Boolean(challenge)} placeholder="지갑 공개키를 입력하세요" /></label>
            {isBrand ? <label className="field"><span>브랜드 초대 코드</span><input name="invite" value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} disabled={Boolean(challenge)} placeholder="발급받은 초대 코드" /></label> : null}

            {challenge ? (
              <>
                <div className="challenge-box"><div><strong>OpenClaw 서명 문구</strong><button className="copy-button" type="button" onClick={copyChallenge}>복사</button></div><pre>{challenge.message}</pre><small>{new Date(challenge.expiresAt).toLocaleString('ko-KR')}까지 유효</small></div>
                <button className="phantom-button full-button" type="button" onClick={signAndRegisterWithPhantom} disabled={pending}>Phantom으로 서명하고 등록</button>
                <label className="field"><span>서명 결과 (Base58)</span><input name="signature" value={signature} onChange={(event) => setSignature(event.target.value)} placeholder="OpenClaw 지갑이 만든 서명" /></label>
              </>
            ) : (
              <div className="signature-note"><strong>등록 순서</strong><span>1. 서명 문구 발급</span><span>2. OpenClaw 지갑으로 서명</span><span>3. Agent ID 생성</span></div>
            )}

            <button className="primary-button full-button" type="submit" disabled={pending}>{pending ? '처리 중…' : challenge ? '서명 확인 및 등록' : '서명 문구 발급'}</button>
            <p className="helper-text">서명에는 비용이 들지 않으며, USDC 전송 권한을 부여하지 않습니다.</p>
          </>
        )}
        {message ? <p className="api-message" role="status">{message}</p> : null}
      </form>
    </div>
  )
}
