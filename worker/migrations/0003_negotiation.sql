ALTER TABLE agents ADD COLUMN session_token_hash TEXT;
ALTER TABLE agents ADD COLUMN session_expires_at TEXT;
ALTER TABLE audit_events ADD COLUMN campaign_id TEXT;

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  brand_agent_id TEXT NOT NULL,
  creator_agent_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('negotiating', 'accepted', 'cancelled')),
  accepted_offer_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (brand_agent_id) REFERENCES agents(id),
  FOREIGN KEY (creator_agent_id) REFERENCES agents(id)
);

CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('offer', 'counter')),
  deliverable TEXT NOT NULL,
  deadline TEXT NOT NULL,
  deposit_usdc TEXT NOT NULL,
  balance_usdc TEXT NOT NULL,
  bonus_usdc TEXT NOT NULL,
  kpi_type TEXT NOT NULL,
  kpi_threshold INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'superseded')),
  created_at TEXT NOT NULL,
  decided_at TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE TABLE IF NOT EXISTS deal_acceptances (
  campaign_id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL UNIQUE,
  accepted_by_agent_id TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  FOREIGN KEY (offer_id) REFERENCES offers(id),
  FOREIGN KEY (accepted_by_agent_id) REFERENCES agents(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_session_token ON agents(session_token_hash) WHERE session_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_agents ON campaigns(brand_agent_id, creator_agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_offers_campaign ON offers(campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_campaign ON audit_events(campaign_id, created_at);
