import bs58 from 'bs58'

export type PhantomProvider = {
  isPhantom?: boolean
  connect: () => Promise<{ publicKey: { toString: () => string } }>
  signMessage?: (message: Uint8Array, display?: string) => Promise<{ signature: Uint8Array } | Uint8Array>
  signAndSendTransaction?: (transaction: unknown) => Promise<{ signature: string } | string>
}

function getPhantomProvider(): PhantomProvider | null {
  const browserWindow = window as typeof window & {
    phantom?: { solana?: PhantomProvider }
    solana?: PhantomProvider
  }
  const provider = browserWindow.phantom?.solana ?? browserWindow.solana
  return provider?.isPhantom ? provider : null
}

export async function connectPhantom() {
  const provider = getPhantomProvider()
  if (!provider) throw new Error('Brave에 Phantom 확장 프로그램을 설치하고 이 페이지에서 활성화해 주세요.')
  const connected = await provider.connect()
  return { provider, wallet: connected.publicKey.toString() }
}

export async function signPhantomMessage(provider: PhantomProvider, message: string) {
  if (typeof provider.signMessage !== 'function') throw new Error('현재 Phantom 환경은 메시지 서명을 지원하지 않습니다.')
  const signed = await provider.signMessage(new TextEncoder().encode(message), 'utf8')
  const signatureBytes = signed instanceof Uint8Array ? signed : signed.signature
  return bs58.encode(signatureBytes)
}
