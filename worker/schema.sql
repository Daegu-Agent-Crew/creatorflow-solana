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
  created_at TEXT NOT NULL,
  UNIQUE (wallet, role),
  FOREIGN KEY (challenge_id) REFERENCES auth_challenges(id),
  FOREIGN KEY (invite_id) REFERENCES brand_invites(id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX IF NOT EXISTS idx_challenges_wallet ON auth_challenges(wallet, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_events(agent_id, created_at);
