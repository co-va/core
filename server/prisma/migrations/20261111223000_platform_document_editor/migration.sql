-- Admin-only editorial state. Published legal snapshots remain immutable in PlatformDocumentVersion.
-- Drafts never replace published records until an explicit administrator publish action.
CREATE TABLE "PlatformDocumentDraft" (
  "key" TEXT NOT NULL,
  "application" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "content" TEXT NOT NULL DEFAULT '',
  "edition" TEXT NOT NULL DEFAULT '',
  "requiredForRegistration" BOOLEAN NOT NULL DEFAULT false,
  "baseVersion" INTEGER NOT NULL DEFAULT 0,
  "draftActive" BOOLEAN NOT NULL DEFAULT true,
  "publishedOnce" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformDocumentDraft_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "PlatformDocumentDraft_application_check" CHECK ("application" IN ('professional','user'))
);

-- Each subsequently published snapshot has its own editorial revision label.
-- This metadata never changes signed historical content.
ALTER TABLE "PlatformDocumentVersion"
  ADD COLUMN IF NOT EXISTS "editorEdition" TEXT;
ALTER TABLE "PlatformDocumentVersion"
  ADD COLUMN IF NOT EXISTS "editorTitle" TEXT;
