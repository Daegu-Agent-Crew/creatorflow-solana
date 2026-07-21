import type { PhantomProvider } from './phantom'
import type { PaymentRequest } from './api'

const tokenProgramAddress = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const associatedTokenProgramAddress = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
const memoProgramAddress = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'
const devnetRpcUrl = 'https://api.devnet.solana.com'

function writeU64(buffer: Uint8Array, offset: number, amount: bigint) {
  let remaining = amount
  for (let index = 0; index < 8; index += 1) {
    buffer[offset + index] = Number(remaining & 255n)
    remaining >>= 8n
  }
}

async function sendAndConfirm(provider: PhantomProvider, transaction: any, feePayer: any, connection: any) {
  if (typeof provider.signAndSendTransaction !== 'function') throw new Error('현재 Phantom 환경은 Solana 거래 전송을 지원하지 않습니다.')
  const blockhash = await connection.getLatestBlockhash('confirmed')
  transaction.feePayer = feePayer
  transaction.recentBlockhash = blockhash.blockhash
  const result = await provider.signAndSendTransaction(transaction)
  const signature = typeof result === 'string' ? result : result.signature
  const confirmation = await connection.confirmTransaction({ signature, ...blockhash }, 'confirmed')
  if (confirmation.value.err) throw new Error('Solana 거래가 실패했습니다.')
  return signature
}

export async function approveDevnetUsdcDelegate(provider: PhantomProvider, input: { ownerWallet: string; delegateWallet: string; mint: string; allowanceBaseUnits: string }) {
  const [{ Connection, PublicKey, Transaction, TransactionInstruction }, { Buffer }] = await Promise.all([import('@solana/web3.js'), import('buffer')])
  const connection = new Connection(devnetRpcUrl, 'confirmed')
  const owner = new PublicKey(input.ownerWallet)
  const delegate = new PublicKey(input.delegateWallet)
  const mint = new PublicKey(input.mint)
  const tokenProgram = new PublicKey(tokenProgramAddress)
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(owner, { mint }, 'confirmed')
  const source = tokenAccounts.value.find((account) => {
    const parsed = account.account.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } }
    return BigInt(parsed.parsed?.info?.tokenAmount?.amount ?? '0') >= BigInt(input.allowanceBaseUnits)
  })?.pubkey
  if (!source) throw new Error('브랜드 지갑의 Devnet USDC 잔액이 위임 한도보다 적습니다.')
  const data = Buffer.alloc(10)
  data.writeUInt8(13, 0)
  writeU64(data, 1, BigInt(input.allowanceBaseUnits))
  data.writeUInt8(6, 9)
  const transaction = new Transaction().add(new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: delegate, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  }))
  return { transactionSignature: await sendAndConfirm(provider, transaction, owner, connection), tokenAccount: source.toString() }
}

export async function revokeDevnetUsdcDelegate(provider: PhantomProvider, input: { ownerWallet: string; tokenAccount: string }) {
  const [{ Connection, PublicKey, Transaction, TransactionInstruction }, { Buffer }] = await Promise.all([import('@solana/web3.js'), import('buffer')])
  const connection = new Connection(devnetRpcUrl, 'confirmed')
  const owner = new PublicKey(input.ownerWallet)
  const transaction = new Transaction().add(new TransactionInstruction({
    programId: new PublicKey(tokenProgramAddress),
    keys: [{ pubkey: new PublicKey(input.tokenAccount), isSigner: false, isWritable: true }, { pubkey: owner, isSigner: true, isWritable: false }],
    data: Buffer.from([5]),
  }))
  return sendAndConfirm(provider, transaction, owner, connection)
}

export async function sendDevnetUsdcPayment(provider: PhantomProvider, payment: PaymentRequest) {
  if (typeof provider.signAndSendTransaction !== 'function') throw new Error('현재 Phantom 환경은 Solana 거래 전송을 지원하지 않습니다.')
  const [{ Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction }, { Buffer }] = await Promise.all([
    import('@solana/web3.js'),
    import('buffer'),
  ])
  const connection = new Connection(devnetRpcUrl, 'confirmed')
  const sender = new PublicKey(payment.senderWallet)
  const recipient = new PublicKey(payment.recipientWallet)
  const mint = new PublicKey(payment.mint)
  const tokenProgram = new PublicKey(tokenProgramAddress)
  const associatedTokenProgram = new PublicKey(associatedTokenProgramAddress)
  const memoProgram = new PublicKey(memoProgramAddress)

  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(sender, { mint }, 'confirmed')
  const source = tokenAccounts.value.find((account) => {
    const parsed = account.account.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } }
    return BigInt(parsed.parsed?.info?.tokenAmount?.amount ?? '0') >= BigInt(payment.amountBaseUnits)
  })?.pubkey
  if (!source) throw new Error('브랜드 지갑의 Devnet USDC 잔액이 부족합니다.')

  const [destination] = PublicKey.findProgramAddressSync([recipient.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], associatedTokenProgram)
  const transaction = new Transaction()
  if (!(await connection.getAccountInfo(destination, 'confirmed'))) {
    transaction.add(new TransactionInstruction({
      programId: associatedTokenProgram,
      keys: [
        { pubkey: sender, isSigner: true, isWritable: true },
        { pubkey: destination, isSigner: false, isWritable: true },
        { pubkey: recipient, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1]),
    }))
  }

  const transferData = Buffer.alloc(10)
  transferData.writeUInt8(12, 0)
  writeU64(transferData, 1, BigInt(payment.amountBaseUnits))
  transferData.writeUInt8(6, 9)
  transaction.add(new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: sender, isSigner: true, isWritable: false },
    ],
    data: transferData,
  }))
  transaction.add(new TransactionInstruction({
    programId: memoProgram,
    keys: [{ pubkey: sender, isSigner: true, isWritable: false }],
    data: Buffer.from(payment.memo, 'utf8'),
  }))

  const blockhash = await connection.getLatestBlockhash('confirmed')
  transaction.feePayer = sender
  transaction.recentBlockhash = blockhash.blockhash
  const result = await provider.signAndSendTransaction(transaction)
  const signature = typeof result === 'string' ? result : result.signature
  const confirmation = await connection.confirmTransaction({ signature, ...blockhash }, 'confirmed')
  if (confirmation.value.err) throw new Error('Solana 거래가 실패했습니다.')
  return signature
}
