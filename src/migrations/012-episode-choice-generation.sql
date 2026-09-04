ALTER TABLE episode_choices
  ADD COLUMN IF NOT EXISTS "generationStatus" varchar NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS "generationJobId" varchar NULL,
  ADD COLUMN IF NOT EXISTS "targetEpisodeNumber" integer NULL,
  ADD COLUMN IF NOT EXISTS "generationError" text NULL,
  ADD COLUMN IF NOT EXISTS "updatedAt" timestamp NULL;

UPDATE episode_choices
SET "updatedAt" = "createdAt"
WHERE "updatedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_episode_choices_generation_job"
  ON episode_choices ("generationJobId")
  WHERE "generationJobId" IS NOT NULL;
