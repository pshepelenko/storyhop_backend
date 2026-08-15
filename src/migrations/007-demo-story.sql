CREATE TABLE IF NOT EXISTS demo_stories (
  "demoStoryId" varchar PRIMARY KEY,
  "slug" varchar NOT NULL UNIQUE,
  "title" varchar NOT NULL,
  "scenario" text NOT NULL,
  "framework" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" varchar NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS demo_story_nodes (
  "nodeId" varchar PRIMARY KEY,
  "demoStoryId" varchar NOT NULL REFERENCES demo_stories("demoStoryId") ON DELETE CASCADE,
  "nodeKey" varchar NOT NULL,
  "episodeNumber" integer NOT NULL,
  "title" varchar NOT NULL,
  "chapterText" text NOT NULL,
  "introOptionsPhrase" text NOT NULL,
  "highlightedVocabulary" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "choices" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "illustrationPrompt" text NOT NULL,
  "imageUrl" text NULL,
  "audioChunks" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "isStart" boolean NOT NULL DEFAULT false,
  "isEnding" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uq_demo_story_nodes_story_key UNIQUE ("demoStoryId", "nodeKey")
);

CREATE INDEX IF NOT EXISTS idx_demo_story_nodes_story_episode
  ON demo_story_nodes ("demoStoryId", "episodeNumber");
