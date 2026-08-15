CREATE TABLE IF NOT EXISTS bonus_practice_states (
  "stateId" varchar PRIMARY KEY,
  "seasonId" varchar NOT NULL UNIQUE REFERENCES seasons("seasonId") ON DELETE CASCADE,
  "ownerUserId" varchar NOT NULL,
  "skippedSpeakingQueue" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "writingState" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "storyRecapState" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bonus_practice_states_owner_user_id
  ON bonus_practice_states ("ownerUserId");
