ALTER TABLE "DataTransferFact" ADD COLUMN "ownership" JSONB NOT NULL DEFAULT '{}'::jsonb;
