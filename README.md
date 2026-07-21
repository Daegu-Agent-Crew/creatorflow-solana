# CreatorFlow Solana

CreatorFlow는 Solana AI Agentic Hackathon을 위한 YouTube 크리에이터 커머스 데모입니다. Gemini를 두뇌로 쓰는 두 OpenClaw 에이전트가 캠페인을 협상하고, YouTube 결과물을 검증한 뒤, 소유자가 허용한 한도 안에서 Circle Devnet USDC 지급을 준비합니다.

## 현재 단계

Phase 3 협상 기반까지 구현했습니다.

- 한국어 캠페인·에이전트·활동 기록 UI
- 크리에이터 공개 등록, 브랜드 초대 등록
- Brave/Chrome Phantom 확장 프로그램 직접 메시지 서명 등록
- 5분 유효 지갑 서명 문구와 1회 사용 방지
- 서버 생성 Agent ID와 D1 감사 기록
- 등록 시 발급되는 24시간 에이전트 세션
- 등록 지갑 재서명으로 기존 Agent ID의 24시간 세션 재발급
- 브랜드 캠페인 생성, 제안·반대 제안·상대 제안 수락
- 0.10 USDC 상한 정책과 중복 수락 차단
- 캠페인별 append-only 감사 API
- 웹에서 두 에이전트가 조작하는 협상 작업대
- 공개 YouTube 영상 확인·캠페인 연결·D1 등록
- 기존 영상의 크리에이터 지갑 제출 서명 보강
- Phantom에서 0.03 Devnet USDC 전송 및 Worker 온체인 검증
- 데스크톱·태블릿·모바일 대응

상단 캠페인 요약과 하단 협상 작업대는 Worker/D1의 실제 등록 영상을 표시합니다. 현재 YouTube 공개 여부는 공식 oEmbed 응답으로 확인하며, Google OAuth 채널 소유권 검증과 Solana 거래는 다음 단계입니다.

## 개발

```bash
npm install
npm run dev
npm run lint
npm test
npm run worker:types
npm run build
```

프런트엔드가 Worker를 호출하려면 `.env.local`에 API 주소를 지정합니다.

```bash
VITE_API_BASE_URL=https://creatorflow-api.sfex11.workers.dev
```

Vite는 상대 경로로 빌드되므로 결과물을 `ai-solana-agent/creatorflow/`에 옮겨도 자산 경로가 깨지지 않습니다.

## Worker와 D1

로컬 실행:

```bash
npx wrangler d1 execute creatorflow --local --file worker/schema.sql --config worker/wrangler.jsonc
npm run worker:dev -- --local
```

Cloudflare 배포:

```bash
npx wrangler login
npx wrangler d1 create creatorflow
# 발급된 database_id를 worker/wrangler.jsonc에 반영
npx wrangler d1 execute creatorflow --remote --file worker/schema.sql --config worker/wrangler.jsonc
npx wrangler deploy --config worker/wrangler.jsonc
```

등록 API는 `POST /api/auth/challenge`, `POST /api/agents/register`를 제공합니다. 재로그인은 `POST /api/auth/login-challenge`, `POST /api/agents/login`을 사용합니다. 등록 또는 로그인 응답의 세션 토큰은 한 번만 노출되며 D1에는 SHA-256 해시만 저장됩니다. 브랜드 초대 코드 역시 원문이 아닌 해시로 저장합니다.

협상 API:

- `GET|POST /api/campaigns`
- `GET /api/campaigns/:campaignId`
- `POST /api/campaigns/:campaignId/offers`
- `POST /api/offers/:offerId/accept|reject`
- `GET /api/campaigns/:campaignId/audit`

영상 API:

- `GET /api/videos`
- `POST /api/videos/challenge` — 공개 영상 확인 및 짧은 제출 서명 문구 발급
- `POST /api/videos/submit` — 크리에이터 지갑 서명을 검증하고 제출 확정
- `POST /api/videos/:submissionId/attestation-challenge` — 기존 등록 영상의 제출 서명 보강

지급 API:

- `GET /api/payments`
- `POST /api/payments/request` — 영상 제출 서명 후 브랜드 지급 요청 생성
- `POST /api/payments/:paymentId/confirm` — Solana 거래 서명 검증 및 지급 확정

영상 공개 마일스톤은 공식 Circle Solana Devnet USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`의 `0.03 USDC`만 허용합니다. Phantom이 거래와 필요한 크리에이터 Associated Token Account 생성을 직접 서명하며, Worker는 개인키를 보관하지 않습니다. Worker는 발신·수신 지갑, mint, 30,000 base units, CreatorFlow 지급 메모, 거래 성공 여부를 모두 확인한 뒤 감사 기록에 반영합니다.

쓰기 요청은 등록 응답에서 받은 `Authorization: Bearer <sessionToken>`이 필요합니다. 세션은 24시간 뒤 만료됩니다.

## YouTube 결과물 검증 기준

YouTube URL만으로는 에이전트가 만든 영상인지 확인할 수 없습니다. 구현 단계에서는 다음 증거를 함께 저장합니다.

1. 크리에이터가 Google OAuth로 연결한 YouTube 채널 ID
2. 제출된 영상의 `snippet.channelId`가 연결 채널 ID와 같은지 확인한 결과
3. 크리에이터 Agent ID가 제출 내용을 지갑으로 서명한 감사 기록
4. 제작 시작 전에 저장한 대본·최종 파일 SHA-256과 OpenClaw 실행 ID
5. 확인 시각의 공개 상태, 조회수, YouTube 응답 ETag 스냅샷

1~2번은 해당 크리에이터가 관리하는 채널에 업로드됐음을 증명하고, 3~4번은 OpenClaw 에이전트 작업에서 나온 결과물임을 보강합니다. YouTube Data API만으로 영상 편집 주체까지 증명할 수는 없습니다. OAuth 토큰은 D1 원문 저장을 피하고 암호화된 서버 저장소에서 관리합니다.

영상 제출 서명은 사용자에게 `영상 ID`, `짧은 확인번호`, `결제 권한 없음`만 보여 줍니다. Agent ID, 캠페인 ID, 제출 시간은 일회용 서명 문구 레코드에 서버가 자동으로 연결합니다.

현재 배포된 등록 API: <https://creatorflow-api.sfex11.workers.dev/api/health>

## 안전 원칙

- Solana Devnet only
- official Circle Devnet USDC mint only
- private keys stay in the OpenClaw wallet secret store
- CreatorFlow stores public keys and signed challenges, never secret keys
- milestone payment requests are idempotent

상세 요구사항은 [CLE2-16](https://daegu-agent-crew.github.io/creative-loop-engineering2/#/tasks/CLE2-16)에서 관리합니다.
