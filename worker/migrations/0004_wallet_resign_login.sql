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

CREATE INDEX IF NOT EXISTS idx_login_challenges_agent ON login_challenges(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent ON agent_sessions(agent_id, created_at);
