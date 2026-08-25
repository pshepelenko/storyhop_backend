CREATE TABLE IF NOT EXISTS season_drafts (
  "draftId" varchar PRIMARY KEY,
  "ownerUserId" varchar NOT NULL REFERENCES users("userId") ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  step integer NOT NULL DEFAULT 1,
  status varchar NOT NULL DEFAULT 'active',
  "createdSeasonId" varchar NULL REFERENCES seasons("seasonId") ON DELETE SET NULL,
  "idempotencyKey" varchar NULL,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "updatedAt" timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT "CHK_season_drafts_step" CHECK (step BETWEEN 1 AND 3),
  CONSTRAINT "CHK_season_drafts_status" CHECK (status IN ('active', 'submitted', 'abandoned'))
);

CREATE INDEX IF NOT EXISTS "IDX_season_drafts_owner_updated" ON season_drafts ("ownerUserId", "updatedAt" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_season_drafts_idempotency_key" ON season_drafts ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;
