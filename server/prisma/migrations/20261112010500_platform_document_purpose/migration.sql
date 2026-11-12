-- Document editor purpose is a separate choice from legal/working status.
-- Existing published consent snapshots and source document classifications are untouched.
ALTER TABLE "PlatformDocument"
  ADD COLUMN IF NOT EXISTS "purpose" TEXT;
ALTER TABLE "PlatformDocumentDraft"
  ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'OPTIONAL';
-- Existing drafts predate the purpose selector. Preserve their mandatory designation.
UPDATE "PlatformDocumentDraft"
SET "purpose" = CASE
  WHEN "requiredForRegistration" THEN 'REQUIRED'
  WHEN "type" = 'RKN_GUIDE_TEMPLATE' THEN 'REFERENCE'
  ELSE 'OPTIONAL'
END;
ALTER TABLE "PlatformDocument"
  ADD CONSTRAINT "PlatformDocument_purpose_check"
  CHECK ("purpose" IS NULL OR "purpose" IN ('REQUIRED','OPTIONAL','READING','REFERENCE'));
ALTER TABLE "PlatformDocumentDraft"
  ADD CONSTRAINT "PlatformDocumentDraft_purpose_check"
  CHECK ("purpose" IN ('REQUIRED','OPTIONAL','READING','REFERENCE'));
