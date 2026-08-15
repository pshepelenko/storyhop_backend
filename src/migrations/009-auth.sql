CREATE TABLE IF NOT EXISTS users (
  "userId" varchar PRIMARY KEY,
  "threadsIDs" text[] NOT NULL DEFAULT '{}',
  "activeThread" varchar NOT NULL DEFAULT '',
  channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  subscriptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  narratives text[] NOT NULL DEFAULT '{}',
  subchallenges text[] NOT NULL DEFAULT '{}',
  email varchar NOT NULL DEFAULT '',
  "childName" varchar NOT NULL DEFAULT '',
  "googleId" varchar NOT NULL DEFAULT '',
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "lastActiveAt" timestamp NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS "accountType" varchar NOT NULL DEFAULT 'guest';
ALTER TABLE users ADD COLUMN IF NOT EXISTS "passwordHash" text;

CREATE TABLE IF NOT EXISTS auth_sessions (
  "sessionId" varchar PRIMARY KEY,
  "tokenHash" varchar(64) NOT NULL UNIQUE,
  "userId" varchar NOT NULL,
  "expiresAt" timestamp NOT NULL,
  "revokedAt" timestamp NULL,
  "lastUsedAt" timestamp NULL,
  "createdAt" timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_auth_sessions_userId" ON auth_sessions ("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_account_email" ON users (LOWER(email)) WHERE "accountType" = 'account' AND email <> '';
