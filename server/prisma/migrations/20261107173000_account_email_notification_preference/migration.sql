CREATE TABLE "AccountNotificationPreference" (
  "accountId" TEXT NOT NULL,
  "emailEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountNotificationPreference_pkey" PRIMARY KEY ("accountId")
);

ALTER TABLE "AccountNotificationPreference"
  ADD CONSTRAINT "AccountNotificationPreference_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
