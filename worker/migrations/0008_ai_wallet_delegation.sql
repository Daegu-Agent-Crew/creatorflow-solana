CREATE TABLE IF NOT EXISTS brand_wallet_delegations (
  id TEXT PRIMARY KEY,
  brand_agent_id TEXT NOT NULL,
  owner_wallet TEXT NOT NULL,
  delegate_wallet TEXT NOT NULL,
  token_account TEXT NOT NULL,
  mint TEXT NOT NULL,
  allowance_base_units TEXT NOT NULL,
  approval_signature TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  revocation_signature TEXT UNIQUE,
  FOREIGN KEY (brand_agent_id) REFERENCES agents(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_active_brand_delegation
  ON brand_wallet_delegations(brand_agent_id, status) WHERE status = 'active';

ALTER TABLE payment_requests ADD COLUMN authority_wallet TEXT;
