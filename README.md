# CreatorFlow Solana

CreatorFlow is an agentic YouTube creator-commerce demo for the Solana AI Agentic Hackathon. Two OpenClaw agents powered by Gemini negotiate a campaign, verify YouTube delivery, and release Circle Devnet USDC within an owner-approved delegated allowance.

## Current phase

Phase 2 establishes the GitHub Pages UI contract:

- campaign overview and milestone states
- Brand Agent action console
- Creator Agent YouTube submission console
- shared audit timeline
- responsive desktop and mobile layouts

The screens currently use deterministic demo data. Wallet challenge registration, Cloudflare Worker/D1, YouTube Data API, and Solana transactions are implemented in the following phases.

## Development

```bash
npm install
npm run dev
npm run lint
npm run build
```

Vite uses a relative asset base so the build can be synchronized into `ai-solana-agent/creatorflow/` without broken paths.

## Safety contract

- Solana Devnet only
- official Circle Devnet USDC mint only
- private keys stay in the OpenClaw wallet secret store
- CreatorFlow stores public keys and signed challenges, never secret keys
- milestone payment requests are idempotent

Detailed requirements are tracked in [CLE2-16](https://daegu-agent-crew.github.io/creative-loop-engineering2/#/tasks/CLE2-16).
