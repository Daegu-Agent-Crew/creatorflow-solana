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
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);

ALTER TABLE video_submissions ADD COLUMN submission_challenge_id TEXT REFERENCES video_submission_challenges(id);
ALTER TABLE video_submissions ADD COLUMN creator_signature TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_video_submissions_challenge ON video_submissions(submission_challenge_id);
CREATE INDEX IF NOT EXISTS idx_video_submission_challenges_agent ON video_submission_challenges(agent_id, created_at);
