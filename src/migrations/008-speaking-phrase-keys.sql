ALTER TABLE episodes ADD COLUMN IF NOT EXISTS "speakingPhraseKey" text NULL;

UPDATE episodes
SET "speakingPhraseKey" = NULLIF(
  trim(regexp_replace(lower(coalesce("speakingPrompt", '')), '[^a-z0-9]+', ' ', 'g')),
  ''
)
WHERE "speakingPhraseKey" IS NULL
  AND "speakingPrompt" IS NOT NULL;

WITH ranked AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY "seasonId", "speakingPhraseKey"
      ORDER BY "episodeNumber", "createdAt", "episodeId"
    ) AS duplicate_rank
  FROM episodes
  WHERE "speakingPhraseKey" IS NOT NULL
)
UPDATE episodes AS episode
SET "speakingPhraseKey" = NULL
FROM ranked
WHERE episode.ctid = ranked.ctid
  AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS episodes_season_speaking_phrase_key_unique
  ON episodes ("seasonId", "speakingPhraseKey")
  WHERE "speakingPhraseKey" IS NOT NULL;
