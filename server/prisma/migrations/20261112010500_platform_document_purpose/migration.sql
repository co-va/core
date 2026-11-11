-- Document editor purpose is a separate choice from legal/working status.
-- Existing published consent snapshots and source document classifications are untouched.
ALTER TABLE "PlatformDocument"
  ADD COLUMN IF NOT EXISTS "purpose" TEXT;
ALTER TABLE "PlatformDocumentDraft"
  ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'OPTIONAL';
ALTER TABLE "PlatformDocument"
  ADD CONSTRAINT "PlatformDocument_purpose_check"
  CHECK ("purpose" IS NULL OR "purpose" IN ('REQUIRED','OPTIONAL','READING','REFERENCE'));
ALTER TABLE "PlatformDocumentDraft"
  ADD CONSTRAINT "PlatformDocumentDraft_purpose_check"
  CHECK ("purpose" IN ('REQUIRED','OPTIONAL','READING','REFERENCE'));
