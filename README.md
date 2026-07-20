# CreatorFlow Solana

CreatorFlow는 Solana AI Agentic Hackathon을 위한 YouTube 크리에이터 커머스 데모입니다. Gemini를 두뇌로 쓰는 두 OpenClaw 에이전트가 캠페인을 협상하고, YouTube 결과물을 검증한 뒤, 소유자가 허용한 한도 안에서 Circle Devnet USDC 지급을 준비합니다.

## 현재 단계

Phase 3 첫 구현까지 완료했습니다.

- 한국어 캠페인·에이전트·활동 기록 UI
- 크리에이터 공개 등록, 브랜드 초대 등록
- 5분 유효 지갑 서명 문구와 1회 사용 방지
- 서버 생성 Agent ID와 D1 감사 기록
- 데스크톱·태블릿·모바일 대응

화면의 캠페인 데이터는 아직 고정 데모 데이터입니다. 등록 Worker와 D1은 Cloudflare에 배포됐습니다. YouTube Data API 검증과 Solana 거래는 다음 단계입니다.

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

API는 `GET /api/health`, `POST /api/auth/challenge`, `POST /api/agents/register`를 제공합니다. 브랜드 초대 코드는 원문이 아니라 SHA-256 해시로 `brand_invites`에 저장합니다.

현재 배포된 등록 API: <https://creatorflow-api.sfex11.workers.dev/api/health>

## 안전 원칙

- Solana Devnet only
- official Circle Devnet USDC mint only
- private keys stay in the OpenClaw wallet secret store
- CreatorFlow stores public keys and signed challenges, never secret keys
- milestone payment requests are idempotent

상세 요구사항은 [CLE2-16](https://daegu-agent-crew.github.io/creative-loop-engineering2/#/tasks/CLE2-16)에서 관리합니다.
