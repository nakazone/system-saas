-- Builder accounts: free, platform-level accounts that link to many companies.
CREATE TABLE "BuilderAccount" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "website" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BuilderAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BuilderMember" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "builderAccountId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'office',
    "status" TEXT NOT NULL DEFAULT 'pending_email',
    "tokenHash" TEXT,
    "tokenPurpose" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "invitedById" UUID,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BuilderMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BuilderMember_email_key" ON "BuilderMember"("email");
CREATE UNIQUE INDEX "BuilderMember_tokenHash_key" ON "BuilderMember"("tokenHash");
CREATE INDEX "BuilderMember_builderAccountId_idx" ON "BuilderMember"("builderAccountId");
ALTER TABLE "BuilderMember" ADD CONSTRAINT "BuilderMember_builderAccountId_fkey"
  FOREIGN KEY ("builderAccountId") REFERENCES "BuilderAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BuilderLink" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "builderAccountId" UUID NOT NULL,
    "organizationId" UUID,
    "status" TEXT NOT NULL DEFAULT 'invited',
    "tenantBuilderId" UUID,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "signupInviteId" UUID,
    "invitedById" UUID,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BuilderLink_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BuilderLink_builderAccountId_status_idx" ON "BuilderLink"("builderAccountId", "status");
CREATE INDEX "BuilderLink_organizationId_idx" ON "BuilderLink"("organizationId");
CREATE INDEX "BuilderLink_signupInviteId_idx" ON "BuilderLink"("signupInviteId");
ALTER TABLE "BuilderLink" ADD CONSTRAINT "BuilderLink_builderAccountId_fkey"
  FOREIGN KEY ("builderAccountId") REFERENCES "BuilderAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BuilderPendingJob" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "builderLinkId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "files" JSONB NOT NULL DEFAULT '[]',
    "deliveredAt" TIMESTAMP(3),
    "workOrderId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BuilderPendingJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BuilderPendingJob_builderLinkId_deliveredAt_idx" ON "BuilderPendingJob"("builderLinkId", "deliveredAt");
ALTER TABLE "BuilderPendingJob" ADD CONSTRAINT "BuilderPendingJob_builderLinkId_fkey"
  FOREIGN KEY ("builderLinkId") REFERENCES "BuilderLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A company's portal user can stand for a member of a builder account.
ALTER TABLE "PartnerUser" ADD COLUMN "builderMemberId" UUID;
CREATE INDEX "PartnerUser_builderMemberId_idx" ON "PartnerUser"("builderMemberId");

GRANT SELECT, INSERT, UPDATE, DELETE ON "BuilderAccount", "BuilderMember", "BuilderLink", "BuilderPendingJob" TO app_user;
