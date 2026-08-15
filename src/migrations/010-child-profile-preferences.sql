CREATE TABLE IF NOT EXISTS child_profiles (
  "userId" varchar PRIMARY KEY REFERENCES users("userId") ON DELETE CASCADE,
  "displayName" varchar NOT NULL DEFAULT '',
  age integer NULL,
  gender varchar NULL,
  "englishLevel" varchar NULL,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "updatedAt" timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT "CHK_child_profiles_age" CHECK (age IS NULL OR age BETWEEN 6 AND 10),
  CONSTRAINT "CHK_child_profiles_gender" CHECK (gender IS NULL OR gender IN ('girl', 'boy')),
  CONSTRAINT "CHK_child_profiles_level" CHECK ("englishLevel" IS NULL OR "englishLevel" IN ('A1', 'A2', 'B1'))
);

CREATE TABLE IF NOT EXISTS user_preferences (
  "userId" varchar PRIMARY KEY REFERENCES users("userId") ON DELETE CASCADE,
  "interfaceLanguage" varchar NOT NULL DEFAULT 'english',
  "playbackRate" numeric(3,2) NOT NULL DEFAULT 1,
  "readingTextSize" varchar NOT NULL DEFAULT 'medium',
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "updatedAt" timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT "CHK_user_preferences_language" CHECK ("interfaceLanguage" IN ('russian', 'english')),
  CONSTRAINT "CHK_user_preferences_rate" CHECK ("playbackRate" IN (0.90, 1.00, 1.15)),
  CONSTRAINT "CHK_user_preferences_text_size" CHECK ("readingTextSize" IN ('small', 'medium', 'large'))
);

INSERT INTO child_profiles ("userId", "displayName", age, "englishLevel", "createdAt", "updatedAt")
SELECT DISTINCT ON (s."ownerUserId")
  s."ownerUserId",
  COALESCE(NULLIF(s."childProfile"->>'childName', ''), u."childName", ''),
  CASE WHEN (s."childProfile"->>'childAge') ~ '^[0-9]+$' THEN LEAST(10, GREATEST(6, (s."childProfile"->>'childAge')::integer)) ELSE NULL END,
  CASE
    WHEN UPPER(COALESCE(s."childProfile"->>'languageLevel', '')) IN ('A0', 'A1') THEN 'A1'
    WHEN UPPER(COALESCE(s."childProfile"->>'languageLevel', '')) IN ('A2', 'A2_B1') THEN 'A2'
    WHEN UPPER(COALESCE(s."childProfile"->>'languageLevel', '')) IN ('B1', 'B1_PLUS') THEN 'B1'
    ELSE NULL
  END,
  NOW(), NOW()
FROM seasons s
JOIN users u ON u."userId" = s."ownerUserId"
ORDER BY s."ownerUserId", s."updatedAt" DESC
ON CONFLICT ("userId") DO NOTHING;

INSERT INTO user_preferences ("userId", "interfaceLanguage", "playbackRate", "readingTextSize", "createdAt", "updatedAt")
SELECT "userId", 'english', 1, 'medium', NOW(), NOW()
FROM users
ON CONFLICT ("userId") DO NOTHING;
