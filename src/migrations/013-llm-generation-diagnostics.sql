CREATE TABLE IF NOT EXISTS llm_generation_diagnostics (
  "diagnosticId" varchar PRIMARY KEY,
  "seasonId" varchar NULL,
  "jobId" varchar NULL,
  "stage" varchar NOT NULL,
  "attempt" integer NOT NULL,
  "failureKind" varchar NOT NULL,
  "model" varchar NOT NULL,
  "requestedProvider" jsonb NULL,
  "actualProvider" varchar NULL,
  "durationMs" integer NULL,
  "httpStatus" integer NULL,
  "responseId" varchar NULL,
  "finishReason" varchar NULL,
  "usage" jsonb NULL,
  "validationIssues" jsonb NULL,
  "payloadCiphertext" text NULL,
  "encryptionIv" varchar NULL,
  "encryptionAuthTag" varchar NULL,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "expiresAt" timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS "IDX_llm_generation_diagnostics_expires_at"
  ON llm_generation_diagnostics ("expiresAt");

CREATE INDEX IF NOT EXISTS "IDX_llm_generation_diagnostics_season_job"
  ON llm_generation_diagnostics ("seasonId", "jobId");
