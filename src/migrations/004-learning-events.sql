CREATE TABLE IF NOT EXISTS learning_events (
  event_id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL,
  season_id UUID,
  episode_id UUID,
  event_type VARCHAR(64) NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_events_owner_created
  ON learning_events (owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_learning_events_season
  ON learning_events (season_id, created_at DESC);
