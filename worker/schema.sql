CREATE TABLE IF NOT EXISTS brand_invites (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  used_by_agent_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_challenges (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('brand', 'creator')),
  message TEXT NOT NULL,
  invite_id TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (invite_id) REFERENCES brand_invites(id)
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('brand', 'creator')),
  wallet TEXT NOT NULL,
  challenge_id TEXT NOT NULL UNIQUE,
  invite_id TEXT UNIQUE,
  session_token_hash TEXT UNIQUE,
  session_expires_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (wallet, role),
  FOREIGN KEY (challenge_id) REFERENCES auth_challenges(id),
  FOREIGN KEY (invite_id) REFERENCES brand_invites(id)
);

CREATE TABLE IF NOT EXISTS login_challenges (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  wallet TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('brand', 'creator')),
  message TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (challenge_id) REFERENCES login_challenges(id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  campaign_id TEXT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

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

CREATE TABLE IF NOT EXISTS video_submission_challenges (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  message TEXT NOT NULL,
  youtube_url TEXT NOT NULL,
  title TEXT NOT NULL,
  channel_title TEXT NOT NULL,
  thumbnail_url TEXT,
  submission_id TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  FOREIGN KEY (submission_id) REFERENCES video_submissions(id)
);

CREATE TABLE IF NOT EXISTS video_submissions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL UNIQUE,
  creator_agent_id TEXT NOT NULL,
  video_id TEXT NOT NULL UNIQUE,
  youtube_url TEXT NOT NULL,
  title TEXT NOT NULL,
  channel_title TEXT NOT NULL,
  thumbnail_url TEXT,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('public_verified', 'channel_verified')),
  created_at TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  submission_challenge_id TEXT UNIQUE,
  creator_signature TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  FOREIGN KEY (creator_agent_id) REFERENCES agents(id),
  FOREIGN KEY (submission_challenge_id) REFERENCES video_submission_challenges(id)
);

CREATE TABLE IF NOT EXISTS payment_requests (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  milestone TEXT NOT NULL CHECK (milestone IN ('video_publication')),
  from_agent_id TEXT NOT NULL,
  to_agent_id TEXT NOT NULL,
  sender_wallet TEXT NOT NULL,
  authority_wallet TEXT,
  recipient_wallet TEXT NOT NULL,
  mint TEXT NOT NULL,
  amount_base_units TEXT NOT NULL,
  amount_usdc TEXT NOT NULL,
  memo TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('requested', 'confirmed')),
  transaction_signature TEXT UNIQUE,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  UNIQUE (campaign_id, milestone),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  FOREIGN KEY (offer_id) REFERENCES offers(id),
  FOREIGN KEY (from_agent_id) REFERENCES agents(id),
  FOREIGN KEY (to_agent_id) REFERENCES agents(id)
);

CREATE TABLE IF NOT EXISTS video_attestations (
  submission_id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL UNIQUE,
  agent_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES video_submissions(id),
  FOREIGN KEY (challenge_id) REFERENCES video_submission_challenges(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX IF NOT EXISTS idx_challenges_wallet ON auth_challenges(wallet, created_at);
CREATE INDEX IF NOT EXISTS idx_login_challenges_agent ON login_challenges(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent ON agent_sessions(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_events(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_campaigns_agents ON campaigns(brand_agent_id, creator_agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_offers_campaign ON offers(campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_campaign ON audit_events(campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_video_submissions_creator ON video_submissions(creator_agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_video_submission_challenges_agent ON video_submission_challenges(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_video_submission_challenges_submission ON video_submission_challenges(submission_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_requests_campaign ON payment_requests(campaign_id, created_at);

CREATE TABLE IF NOT EXISTS brand_wallet_delegations (
  id TEXT PRIMARY KEY,
  brand_agent_id TEXT NOT NULL,
  campaign_id TEXT,
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
  FOREIGN KEY (brand_agent_id) REFERENCES agents(id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_brand_delegation
  ON brand_wallet_delegations(brand_agent_id, status) WHERE status = 'active';

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
CREATE UNIQUE INDEX IF NOT EXISTS idx_creatorflow2_unique_video ON creatorflow2_offers(video_id) WHERE video_id IS NOT NULL;

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
