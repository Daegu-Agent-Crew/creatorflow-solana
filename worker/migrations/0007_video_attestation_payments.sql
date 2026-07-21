ALTER TABLE video_submission_challenges ADD COLUMN submission_id TEXT REFERENCES video_submissions(id);

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

CREATE TABLE IF NOT EXISTS payment_requests (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  milestone TEXT NOT NULL CHECK (milestone IN ('video_publication')),
  from_agent_id TEXT NOT NULL,
  to_agent_id TEXT NOT NULL,
  sender_wallet TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_payment_requests_campaign ON payment_requests(campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_video_submission_challenges_submission ON video_submission_challenges(submission_id, created_at);
