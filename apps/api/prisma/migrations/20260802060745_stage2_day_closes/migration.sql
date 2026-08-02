-- CreateTable
CREATE TABLE "day_closes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID,
    "terminalId" UUID NOT NULL,
    "businessDate" DATE NOT NULL,
    "expectedCash" INTEGER NOT NULL,
    "countedCash" INTEGER NOT NULL,
    "variance" INTEGER NOT NULL,
    "note" TEXT,
    "closedBy" UUID,
    "opId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "day_closes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "day_closes_tenantId_businessDate_idx" ON "day_closes"("tenantId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "day_closes_tenantId_opId_key" ON "day_closes"("tenantId", "opId");

-- CreateIndex
CREATE UNIQUE INDEX "day_closes_tenantId_terminalId_businessDate_key" ON "day_closes"("tenantId", "terminalId", "businessDate");
