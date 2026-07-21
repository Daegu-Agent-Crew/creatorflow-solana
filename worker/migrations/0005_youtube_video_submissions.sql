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

CREATE INDEX IF NOT EXISTS idx_video_submissions_creator ON video_submissions(creator_agent_id, created_at);
