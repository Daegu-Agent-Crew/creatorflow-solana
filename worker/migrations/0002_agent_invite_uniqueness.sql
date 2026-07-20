ALTER TABLE agents ADD COLUMN invite_id TEXT REFERENCES brand_invites(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_invite ON agents(invite_id);
