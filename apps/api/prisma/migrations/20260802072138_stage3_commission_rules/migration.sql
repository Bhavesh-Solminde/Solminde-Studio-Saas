-- CreateTable
CREATE TABLE "commission_rules" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'flat',
    "serviceRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "retailRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "slabs" JSONB,
    "targetBonus" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commission_rules_tenantId_idx" ON "commission_rules"("tenantId");
