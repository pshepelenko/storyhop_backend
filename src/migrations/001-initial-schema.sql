CREATE TABLE IF NOT EXISTS seasons (
  "seasonId" varchar PRIMARY KEY,
  "ownerUserId" varchar NOT NULL,
  "childProfile" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "seasonSetup" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" varchar NOT NULL,
  "promptVersion" varchar NOT NULL,
  "currentEpisodeNumber" integer NOT NULL DEFAULT 1,
  "currentMiniArc" integer NOT NULL DEFAULT 1,
  "storyState" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamp NOT NULL,
  "updatedAt" timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS season_frameworks (
  "id" varchar PRIMARY KEY,
  "seasonId" varchar NOT NULL REFERENCES seasons("seasonId") ON DELETE CASCADE,
  "framework" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "seasonBible" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "episodeOutline" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "generationStatus" varchar NOT NULL,
  "promptVersion" varchar NOT NULL,
  "createdAt" timestamp NOT NULL,
  "updatedAt" timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS heroes (
  "seasonId" varchar PRIMARY KEY REFERENCES seasons("seasonId") ON DELETE CASCADE,
  "heroProfile" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "heroVisualBrief" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "heroReferenceImageUrl" text NULL,
  "generationStatus" varchar NOT NULL,
  "heroPreferences" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "promptVersion" varchar NOT NULL,
  "createdAt" timestamp NOT NULL,
  "updatedAt" timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS episodes (
  "episodeId" varchar PRIMARY KEY,
  "seasonId" varchar NOT NULL REFERENCES seasons("seasonId") ON DELETE CASCADE,
  "episodeNumber" integer NOT NULL,
  "miniArcNumber" integer NOT NULL DEFAULT 1,
  "title" varchar NOT NULL,
  "chapterText" text NOT NULL,
  "introOptionsPhrase" text NOT NULL,
  "highlightedVocabulary" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "choices" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "storyStateDiff" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "illustrationCandidate" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "audioChunks" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "generationStatus" varchar NOT NULL,
  "promptVersion" varchar NOT NULL,
  "createdAt" timestamp NOT NULL,
  "updatedAt" timestamp NOT NULL,
  UNIQUE ("seasonId", "episodeNumber")
);

CREATE TABLE IF NOT EXISTS generation_jobs (
  "jobId" varchar PRIMARY KEY,
  "seasonId" varchar NOT NULL REFERENCES seasons("seasonId") ON DELETE CASCADE,
  "episodeId" varchar NULL REFERENCES episodes("episodeId") ON DELETE CASCADE,
  "jobType" varchar NOT NULL,
  "status" varchar NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "result" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error" text NULL,
  "promptVersion" varchar NOT NULL,
  "createdAt" timestamp NOT NULL,
  "updatedAt" timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS episode_choices (
  "choiceRecordId" varchar PRIMARY KEY,
  "seasonId" varchar NOT NULL REFERENCES seasons("seasonId") ON DELETE CASCADE,
  "episodeId" varchar NOT NULL REFERENCES episodes("episodeId") ON DELETE CASCADE,
  "episodeNumber" integer NOT NULL,
  "choiceId" varchar NOT NULL,
  "choicePayload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "resultingStoryState" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamp NOT NULL,
  UNIQUE ("episodeId")
);

CREATE TABLE IF NOT EXISTS crystal_wallets (
  "walletId" varchar PRIMARY KEY,
  "ownerUserId" varchar NOT NULL,
  "seasonId" varchar NOT NULL UNIQUE REFERENCES seasons("seasonId") ON DELETE CASCADE,
  "balance" integer NOT NULL DEFAULT 0,
  "createdAt" timestamp NOT NULL,
  "updatedAt" timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS crystal_ledger (
  "ledgerEntryId" varchar PRIMARY KEY,
  "walletId" varchar NOT NULL REFERENCES crystal_wallets("walletId") ON DELETE CASCADE,
  "ownerUserId" varchar NOT NULL,
  "seasonId" varchar NOT NULL REFERENCES seasons("seasonId") ON DELETE CASCADE,
  "direction" varchar NOT NULL,
  "amount" integer NOT NULL,
  "reason" varchar NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS illustrations (
  "illustrationId" varchar PRIMARY KEY,
  "seasonId" varchar NOT NULL REFERENCES seasons("seasonId") ON DELETE CASCADE,
  "episodeId" varchar NULL REFERENCES episodes("episodeId") ON DELETE CASCADE,
  "entryType" varchar NOT NULL,
  "title" varchar NOT NULL,
  "status" varchar NOT NULL,
  "imageUrl" text NULL,
  "promptPayload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamp NOT NULL,
  "updatedAt" timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS storybook_entries (
  "storybookEntryId" varchar PRIMARY KEY,
  "seasonId" varchar NOT NULL REFERENCES seasons("seasonId") ON DELETE CASCADE,
  "episodeId" varchar NULL REFERENCES episodes("episodeId") ON DELETE CASCADE,
  "illustrationId" varchar NULL REFERENCES illustrations("illustrationId") ON DELETE SET NULL,
  "entryType" varchar NOT NULL,
  "title" varchar NOT NULL,
  "summary" text NOT NULL,
  "status" varchar NOT NULL,
  "unlockCost" integer NOT NULL DEFAULT 0,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamp NOT NULL,
  "updatedAt" timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS prepared_episodes (
  "preparedEpisodeId" varchar PRIMARY KEY,
  "seasonId" varchar NOT NULL REFERENCES seasons("seasonId") ON DELETE CASCADE,
  "sourceEpisodeId" varchar NOT NULL REFERENCES episodes("episodeId") ON DELETE CASCADE,
  "sourceEpisodeNumber" integer NOT NULL,
  "choiceId" varchar NOT NULL,
  "nextEpisodeNumber" integer NOT NULL,
  "status" varchar NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "promptVersion" varchar NOT NULL,
  "createdAt" timestamp NOT NULL,
  "updatedAt" timestamp NOT NULL,
  UNIQUE ("sourceEpisodeId", "choiceId")
);

CREATE TABLE IF NOT EXISTS referrals (
  "id" varchar PRIMARY KEY,
  "inviterUserId" varchar NOT NULL,
  "invitedUserId" varchar NULL,
  "inviteCode" varchar NOT NULL UNIQUE,
  "status" varchar NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamp NOT NULL,
  "updatedAt" timestamp NOT NULL
);
