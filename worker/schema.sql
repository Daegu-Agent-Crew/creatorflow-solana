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
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  FOREIGN KEY (creator_agent_id) REFERENCES agents(id)
);

CREATE INDEX IF NOT EXISTS idx_challenges_wallet ON auth_challenges(wallet, created_at);
CREATE INDEX IF NOT EXISTS idx_login_challenges_agent ON login_challenges(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent ON agent_sessions(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_events(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_campaigns_agents ON campaigns(brand_agent_id, creator_agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_offers_campaign ON offers(campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_campaign ON audit_events(campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_video_submissions_creator ON video_submissions(creator_agent_id, created_at);
