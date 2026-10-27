CREATE TABLE "AccountCalendarConnection" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "encryptedCredentials" TEXT NOT NULL,
    "credentialsIv" TEXT NOT NULL,
    "credentialsTag" TEXT NOT NULL,
    "exportCalendarId" TEXT NOT NULL DEFAULT '',
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountCalendarConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountCalendarBinding" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalCalendarId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "writable" BOOLEAN NOT NULL DEFAULT false,
    "primary" BOOLEAN NOT NULL DEFAULT false,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "collectionUrl" TEXT NOT NULL DEFAULT '',
    "syncToken" TEXT NOT NULL DEFAULT '',
    "channelId" TEXT NOT NULL DEFAULT '',
    "channelResourceId" TEXT NOT NULL DEFAULT '',
    "channelToken" TEXT NOT NULL DEFAULT '',
    "channelExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountCalendarBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountCalendarItemLink" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "localType" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalHref" TEXT NOT NULL DEFAULT '',
    "externalEtag" TEXT NOT NULL DEFAULT '',
    "lastExternalUpdatedAt" TEXT NOT NULL DEFAULT '',
    "lastLocalUpdatedAt" TEXT NOT NULL DEFAULT '',
    "payloadHash" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountCalendarItemLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountCalendarConnection_accountId_provider_key" ON "AccountCalendarConnection"("accountId", "provider");
CREATE INDEX "AccountCalendarConnection_accountId_status_idx" ON "AccountCalendarConnection"("accountId", "status");
CREATE UNIQUE INDEX "AccountCalendarBinding_connectionId_externalCalendarId_key" ON "AccountCalendarBinding"("connectionId", "externalCalendarId");
CREATE INDEX "AccountCalendarBinding_connectionId_enabled_idx" ON "AccountCalendarBinding"("connectionId", "enabled");
CREATE UNIQUE INDEX "AccountCalendarItemLink_bindingId_externalId_key" ON "AccountCalendarItemLink"("bindingId", "externalId");
CREATE UNIQUE INDEX "AccountCalendarItemLink_connectionId_localType_localId_key" ON "AccountCalendarItemLink"("connectionId", "localType", "localId");
CREATE INDEX "AccountCalendarItemLink_connectionId_localType_idx" ON "AccountCalendarItemLink"("connectionId", "localType");

ALTER TABLE "AccountCalendarConnection" ADD CONSTRAINT "AccountCalendarConnection_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountCalendarBinding" ADD CONSTRAINT "AccountCalendarBinding_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "AccountCalendarConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountCalendarItemLink" ADD CONSTRAINT "AccountCalendarItemLink_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "AccountCalendarConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountCalendarItemLink" ADD CONSTRAINT "AccountCalendarItemLink_bindingId_fkey"
    FOREIGN KEY ("bindingId") REFERENCES "AccountCalendarBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
