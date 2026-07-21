DROP INDEX IF EXISTS idx_active_brand_delegation_campaign;
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_brand_delegation
  ON brand_wallet_delegations(brand_agent_id, status) WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_creatorflow2_unique_video
  ON creatorflow2_offers(video_id) WHERE video_id IS NOT NULL;
