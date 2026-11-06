-- Account-scoped Journal visibility. Hiding never deletes a business Record.
CREATE TABLE "AccountJournalHiddenRecord" (
  "accountId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "hiddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountJournalHiddenRecord_pkey" PRIMARY KEY ("accountId", "tenantId", "recordId")
);

CREATE INDEX "AccountJournalHiddenRecord_accountId_hiddenAt_idx"
  ON "AccountJournalHiddenRecord"("accountId", "hiddenAt");

ALTER TABLE "AccountJournalHiddenRecord"
  ADD CONSTRAINT "AccountJournalHiddenRecord_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
