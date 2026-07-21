CREATE TABLE IF NOT EXISTS creatorflow2_offers (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  brand_agent_id TEXT NOT NULL,
  creator_name TEXT NOT NULL,
  youtube_channel TEXT NOT NULL,
  creator_wallet TEXT,
  fit_score INTEGER NOT NULL CHECK (fit_score BETWEEN 0 AND 100),
  amount_base_units TEXT NOT NULL,
  amount_usdc TEXT NOT NULL,
  ai_rationale TEXT NOT NULL,
  access_token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'accepted', 'submitted', 'verified', 'paid', 'rejected', 'expired')),
  video_id TEXT,
  youtube_url TEXT,
  video_title TEXT,
  verified_channel_title TEXT,
  thumbnail_url TEXT,
  creator_signature TEXT,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  submitted_at TEXT,
  verified_at TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  FOREIGN KEY (brand_agent_id) REFERENCES agents(id)
);

CREATE INDEX IF NOT EXISTS idx_creatorflow2_offers_campaign ON creatorflow2_offers(campaign_id, status, updated_at);

CREATE TABLE IF NOT EXISTS creatorflow2_challenges (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('accept', 'submit')),
  wallet TEXT NOT NULL,
  message TEXT NOT NULL,
  video_id TEXT,
  youtube_url TEXT,
  video_title TEXT,
  verified_channel_title TEXT,
  thumbnail_url TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (offer_id) REFERENCES creatorflow2_offers(id)
);

CREATE INDEX IF NOT EXISTS idx_creatorflow2_challenges_offer ON creatorflow2_challenges(offer_id, created_at);

CREATE TABLE IF NOT EXISTS creatorflow2_payments (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL UNIQUE,
  campaign_id TEXT NOT NULL,
  brand_agent_id TEXT NOT NULL,
  sender_wallet TEXT NOT NULL,
  authority_wallet TEXT NOT NULL,
  recipient_wallet TEXT NOT NULL,
  mint TEXT NOT NULL,
  amount_base_units TEXT NOT NULL,
  amount_usdc TEXT NOT NULL,
  memo TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('prepared', 'confirmed')),
  transaction_signature TEXT UNIQUE,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (offer_id) REFERENCES creatorflow2_offers(id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  FOREIGN KEY (brand_agent_id) REFERENCES agents(id)
);

CREATE INDEX IF NOT EXISTS idx_creatorflow2_payments_campaign ON creatorflow2_payments(campaign_id, created_at);

DROP INDEX IF EXISTS idx_active_brand_delegation;
ALTER TABLE brand_wallet_delegations ADD COLUMN campaign_id TEXT REFERENCES campaigns(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_brand_delegation_campaign
  ON brand_wallet_delegations(brand_agent_id, campaign_id, status) WHERE status = 'active';
