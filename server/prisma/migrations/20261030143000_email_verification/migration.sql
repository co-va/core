ALTER TABLE "PlatformAccount" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Account" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

CREATE TABLE "EmailVerificationTicket" (
  "id" TEXT NOT NULL,
  "subjectKind" TEXT NOT NULL,
  "platformAccountId" TEXT,
  "accountId" TEXT,
  "email" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailVerificationTicket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmailVerificationTicket_subject_check" CHECK ("subjectKind" IN ('PLATFORM', 'ACCOUNT')),
  CONSTRAINT "EmailVerificationTicket_subject_owner_check" CHECK (
    ("subjectKind" = 'PLATFORM' AND "platformAccountId" IS NOT NULL AND "accountId" IS NULL)
    OR ("subjectKind" = 'ACCOUNT' AND "accountId" IS NOT NULL AND "platformAccountId" IS NULL)
  )
);

CREATE UNIQUE INDEX "EmailVerificationTicket_tokenHash_key" ON "EmailVerificationTicket"("tokenHash");
CREATE INDEX "EmailVerificationTicket_platformAccountId_createdAt_idx" ON "EmailVerificationTicket"("platformAccountId", "createdAt");
CREATE INDEX "EmailVerificationTicket_accountId_createdAt_idx" ON "EmailVerificationTicket"("accountId", "createdAt");
CREATE INDEX "EmailVerificationTicket_email_createdAt_idx" ON "EmailVerificationTicket"("email", "createdAt");

ALTER TABLE "EmailVerificationTicket"
  ADD CONSTRAINT "EmailVerificationTicket_platformAccountId_fkey"
  FOREIGN KEY ("platformAccountId") REFERENCES "PlatformAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailVerificationTicket"
  ADD CONSTRAINT "EmailVerificationTicket_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
