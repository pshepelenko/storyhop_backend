CREATE TABLE IF NOT EXISTS season_characters (
  "characterId" varchar NOT NULL,
  "seasonId" varchar NOT NULL,
  "displayName" varchar NOT NULL,
  "internalName" varchar NULL,
  "safeDisplayName" varchar NULL,
  aliases jsonb NOT NULL DEFAULT '[]',
  role varchar NOT NULL,
  type varchar NOT NULL,
  "visualDescription" text NOT NULL,
  "mainColors" jsonb NOT NULL DEFAULT '[]',
  silhouette text NULL,
  "signatureItems" jsonb NOT NULL DEFAULT '[]',
  "personalityVisualCues" text NULL,
  "allowedVariations" jsonb NOT NULL DEFAULT '[]',
  "doNotShow" jsonb NOT NULL DEFAULT '[]',
  "countRule" varchar NOT NULL DEFAULT 'exactly_one_when_selected',
  "duplicatePrevention" text NULL,
  "placementPreference" text NULL,
  "referenceImageUrl" text NULL,
  "referenceUse" text NULL,
  "needsReview" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp NOT NULL,
  "updatedAt" timestamp NOT NULL,
  PRIMARY KEY ("characterId")
);

CREATE INDEX IF NOT EXISTS idx_season_characters_season_id ON season_characters ("seasonId");
