-- DropIndex
DROP INDEX "appointments_tenant_id_start_at_idx";

-- DropIndex
DROP INDEX "attendance_tenant_id_staff_id_date_key";

-- DropIndex
DROP INDEX "audit_log_tenant_id_at_idx";

-- DropIndex
DROP INDEX "bill_lines_bill_id_idx";

-- DropIndex
DROP INDEX "bills_tenant_id_created_at_idx";

-- DropIndex
DROP INDEX "bills_tenant_id_op_id_key";

-- DropIndex
DROP INDEX "bills_tenant_id_series_invoice_no_key";

-- DropIndex
DROP INDEX "customer_packages_tenant_id_customer_id_idx";

-- DropIndex
DROP INDEX "customers_tenant_id_idx";

-- DropIndex
DROP INDEX "customers_tenant_id_phone_key";

-- DropIndex
DROP INDEX "expenses_tenant_id_date_idx";

-- DropIndex
DROP INDEX "locations_tenant_id_idx";

-- DropIndex
DROP INDEX "memberships_tenant_id_idx";

-- DropIndex
DROP INDEX "package_items_tenant_id_idx";

-- DropIndex
DROP INDEX "packages_tenant_id_idx";

-- DropIndex
DROP INDEX "payments_bill_id_idx";

-- DropIndex
DROP INDEX "processed_ops_tenant_id_idx";

-- DropIndex
DROP INDEX "products_tenant_id_idx";

-- DropIndex
DROP INDEX "refresh_tokens_tenant_id_user_id_idx";

-- DropIndex
DROP INDEX "refresh_tokens_token_hash_key";

-- DropIndex
DROP INDEX "resources_tenant_id_idx";

-- DropIndex
DROP INDEX "roles_tenant_id_idx";

-- DropIndex
DROP INDEX "service_categories_tenant_id_idx";

-- DropIndex
DROP INDEX "services_tenant_id_idx";

-- DropIndex
DROP INDEX "session_ledger_tenant_id_customer_id_idx";

-- DropIndex
DROP INDEX "site_media_tenant_id_idx";

-- DropIndex
DROP INDEX "site_sections_tenant_id_position_idx";

-- DropIndex
DROP INDEX "staff_tenant_id_idx";

-- DropIndex
DROP INDEX "stock_ledger_tenant_id_product_id_idx";

-- DropIndex
DROP INDEX "sync_exceptions_tenant_id_status_idx";

-- DropIndex
DROP INDEX "terminals_tenant_id_idx";

-- DropIndex
DROP INDEX "tombstones_tenant_id_deleted_at_idx";

-- DropIndex
DROP INDEX "user_permission_overrides_tenant_id_idx";

-- DropIndex
DROP INDEX "users_tenant_id_idx";

-- DropIndex
DROP INDEX "users_tenant_id_phone_key";

-- DropIndex
DROP INDEX "wallet_ledger_tenant_id_customer_id_idx";

-- AlterTable
ALTER TABLE "appointments" DROP COLUMN "created_at",
DROP COLUMN "customer_id",
DROP COLUMN "end_at",
DROP COLUMN "location_id",
DROP COLUMN "resource_id",
DROP COLUMN "row_version",
DROP COLUMN "service_id",
DROP COLUMN "staff_id",
DROP COLUMN "start_at",
DROP COLUMN "tenant_id",
DROP COLUMN "updated_at",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "customerId" UUID NOT NULL,
ADD COLUMN     "endAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "locationId" UUID,
ADD COLUMN     "resourceId" UUID,
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "serviceId" UUID NOT NULL,
ADD COLUMN     "staffId" UUID,
ADD COLUMN     "startAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "attendance" DROP COLUMN "created_at",
DROP COLUMN "in_at",
DROP COLUMN "out_at",
DROP COLUMN "row_version",
DROP COLUMN "staff_id",
DROP COLUMN "tenant_id",
DROP COLUMN "updated_at",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "inAt" TIMESTAMP(3),
ADD COLUMN     "outAt" TIMESTAMP(3),
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "staffId" UUID NOT NULL,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "audit_log" DROP COLUMN "entity_id",
DROP COLUMN "tenant_id",
DROP COLUMN "user_id",
ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "userId" UUID;

-- AlterTable
ALTER TABLE "bill_lines" DROP COLUMN "bill_id",
DROP COLUMN "commission_amount",
DROP COLUMN "ref_id",
DROP COLUMN "staff_id",
DROP COLUMN "tax_rate",
DROP COLUMN "tenant_id",
DROP COLUMN "unit_price",
ADD COLUMN     "billId" UUID NOT NULL,
ADD COLUMN     "commissionAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refId" UUID,
ADD COLUMN     "staffId" UUID,
ADD COLUMN     "taxRate" DECIMAL(5,2) NOT NULL,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "unitPrice" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "bills" DROP COLUMN "created_at",
DROP COLUMN "created_by",
DROP COLUMN "customer_id",
DROP COLUMN "invoice_no",
DROP COLUMN "location_id",
DROP COLUMN "op_id",
DROP COLUMN "row_version",
DROP COLUMN "tenant_id",
DROP COLUMN "terminal_id",
DROP COLUMN "updated_at",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdBy" UUID,
ADD COLUMN     "customerId" UUID,
ADD COLUMN     "invoiceNo" TEXT NOT NULL,
ADD COLUMN     "locationId" UUID,
ADD COLUMN     "opId" UUID NOT NULL,
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "terminalId" UUID NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "customer_packages" DROP COLUMN "bill_id",
DROP COLUMN "customer_id",
DROP COLUMN "expires_at",
DROP COLUMN "package_id",
DROP COLUMN "purchased_at",
DROP COLUMN "tenant_id",
ADD COLUMN     "billId" UUID,
ADD COLUMN     "customerId" UUID NOT NULL,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "packageId" UUID NOT NULL,
ADD COLUMN     "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "tenantId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "customers" DROP COLUMN "created_at",
DROP COLUMN "first_visit_at",
DROP COLUMN "last_visit_at",
DROP COLUMN "row_version",
DROP COLUMN "tenant_id",
DROP COLUMN "updated_at",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "firstVisitAt" TIMESTAMP(3),
ADD COLUMN     "lastVisitAt" TIMESTAMP(3),
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "expenses" DROP COLUMN "created_at",
DROP COLUMN "created_by",
DROP COLUMN "tenant_id",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdBy" UUID,
ADD COLUMN     "tenantId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "features" DROP COLUMN "default_tier",
DROP COLUMN "depends_on",
ADD COLUMN     "defaultTier" TEXT NOT NULL DEFAULT 'standard',
ADD COLUMN     "dependsOn" TEXT[];

-- AlterTable
ALTER TABLE "invoice_leases" DROP CONSTRAINT "invoice_leases_pkey",
DROP COLUMN "block_end",
DROP COLUMN "block_start",
DROP COLUMN "financial_year",
DROP COLUMN "next_number",
DROP COLUMN "tenant_id",
DROP COLUMN "terminal_id",
ADD COLUMN     "blockEnd" INTEGER NOT NULL,
ADD COLUMN     "blockStart" INTEGER NOT NULL,
ADD COLUMN     "financialYear" TEXT NOT NULL,
ADD COLUMN     "nextNumber" INTEGER NOT NULL,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "terminalId" UUID NOT NULL,
ADD CONSTRAINT "invoice_leases_pkey" PRIMARY KEY ("tenantId", "terminalId", "series", "financialYear", "blockStart");

-- AlterTable
ALTER TABLE "locations" DROP COLUMN "created_at",
DROP COLUMN "is_primary",
DROP COLUMN "row_version",
DROP COLUMN "tenant_id",
DROP COLUMN "updated_at",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isPrimary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "memberships" DROP COLUMN "created_at",
DROP COLUMN "row_version",
DROP COLUMN "tenant_id",
DROP COLUMN "updated_at",
DROP COLUMN "wallet_credit",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "walletCredit" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "package_items" DROP CONSTRAINT "package_items_pkey",
DROP COLUMN "package_id",
DROP COLUMN "service_id",
DROP COLUMN "tenant_id",
ADD COLUMN     "packageId" UUID NOT NULL,
ADD COLUMN     "serviceId" UUID NOT NULL,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD CONSTRAINT "package_items_pkey" PRIMARY KEY ("packageId", "serviceId");

-- AlterTable
ALTER TABLE "packages" DROP COLUMN "created_at",
DROP COLUMN "row_version",
DROP COLUMN "tenant_id",
DROP COLUMN "updated_at",
DROP COLUMN "validity_days",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "validityDays" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "bill_id",
DROP COLUMN "tenant_id",
ADD COLUMN     "billId" UUID NOT NULL,
ADD COLUMN     "tenantId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "processed_ops" DROP CONSTRAINT "processed_ops_pkey",
DROP COLUMN "created_at",
DROP COLUMN "op_id",
DROP COLUMN "tenant_id",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "opId" UUID NOT NULL,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD CONSTRAINT "processed_ops_pkey" PRIMARY KEY ("opId");

-- AlterTable
ALTER TABLE "products" DROP COLUMN "created_at",
DROP COLUMN "reorder_level",
DROP COLUMN "row_version",
DROP COLUMN "tax_rate",
DROP COLUMN "tenant_id",
DROP COLUMN "updated_at",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "reorderLevel" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxRate" DECIMAL(5,2) NOT NULL,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "refresh_tokens" DROP COLUMN "created_at",
DROP COLUMN "expires_at",
DROP COLUMN "revoked_at",
DROP COLUMN "tenant_id",
DROP COLUMN "terminal_id",
DROP COLUMN "token_hash",
DROP COLUMN "user_id",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "expiresAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "terminalId" UUID,
ADD COLUMN     "tokenHash" TEXT NOT NULL,
ADD COLUMN     "userId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "resources" DROP COLUMN "created_at",
DROP COLUMN "location_id",
DROP COLUMN "row_version",
DROP COLUMN "tenant_id",
DROP COLUMN "updated_at",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "locationId" UUID,
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "roles" DROP COLUMN "created_at",
DROP COLUMN "is_system",
DROP COLUMN "row_version",
DROP COLUMN "tenant_id",
DROP COLUMN "updated_at",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tenantId" UUID,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "service_categories" DROP COLUMN "created_at",
DROP COLUMN "row_version",
DROP COLUMN "tenant_id",
DROP COLUMN "updated_at",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "services" DROP COLUMN "category_id",
DROP COLUMN "commission_rule_id",
DROP COLUMN "created_at",
DROP COLUMN "duration_min",
DROP COLUMN "row_version",
DROP COLUMN "tax_rate",
DROP COLUMN "tenant_id",
DROP COLUMN "updated_at",
ADD COLUMN     "categoryId" UUID,
ADD COLUMN     "commissionRuleId" UUID,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "durationMin" INTEGER NOT NULL,
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxRate" DECIMAL(5,2) NOT NULL,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "session_ledger" DROP COLUMN "bill_id",
DROP COLUMN "created_at",
DROP COLUMN "customer_id",
DROP COLUMN "op_id",
DROP COLUMN "package_id",
DROP COLUMN "reverses_id",
DROP COLUMN "service_id",
DROP COLUMN "tenant_id",
DROP COLUMN "terminal_id",
ADD COLUMN     "billId" UUID,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "customerId" UUID NOT NULL,
ADD COLUMN     "opId" UUID NOT NULL,
ADD COLUMN     "packageId" UUID NOT NULL,
ADD COLUMN     "reversesId" UUID,
ADD COLUMN     "serviceId" UUID,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "terminalId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "site_media" DROP COLUMN "tenant_id",
ADD COLUMN     "tenantId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "site_sections" DROP COLUMN "published_at",
DROP COLUMN "row_version",
DROP COLUMN "tenant_id",
DROP COLUMN "updated_at",
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "site_settings" DROP CONSTRAINT "site_settings_pkey",
DROP COLUMN "ga_id",
DROP COLUMN "row_version",
DROP COLUMN "tenant_id",
DROP COLUMN "updated_at",
ADD COLUMN     "gaId" TEXT,
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD CONSTRAINT "site_settings_pkey" PRIMARY KEY ("tenantId");

-- AlterTable
ALTER TABLE "staff" DROP COLUMN "commission_rule_id",
DROP COLUMN "created_at",
DROP COLUMN "display_name",
DROP COLUMN "row_version",
DROP COLUMN "tenant_id",
DROP COLUMN "updated_at",
DROP COLUMN "user_id",
ADD COLUMN     "commissionRuleId" UUID,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "displayName" TEXT NOT NULL,
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "userId" UUID;

-- AlterTable
ALTER TABLE "stock_ledger" DROP COLUMN "bill_id",
DROP COLUMN "created_at",
DROP COLUMN "location_id",
DROP COLUMN "op_id",
DROP COLUMN "product_id",
DROP COLUMN "reverses_id",
DROP COLUMN "tenant_id",
DROP COLUMN "terminal_id",
ADD COLUMN     "billId" UUID,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "locationId" UUID,
ADD COLUMN     "opId" UUID NOT NULL,
ADD COLUMN     "productId" UUID NOT NULL,
ADD COLUMN     "reversesId" UUID,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "terminalId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "sync_exceptions" DROP COLUMN "created_at",
DROP COLUMN "resolved_by",
DROP COLUMN "tenant_id",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "resolvedBy" UUID,
ADD COLUMN     "tenantId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "tenant_features" DROP CONSTRAINT "tenant_features_pkey",
DROP COLUMN "expires_at",
DROP COLUMN "tenant_id",
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD CONSTRAINT "tenant_features_pkey" PRIMARY KEY ("tenantId", "key");

-- AlterTable
ALTER TABLE "tenants" DROP COLUMN "created_at",
DROP COLUMN "gst_number",
DROP COLUMN "row_version",
DROP COLUMN "updated_at",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "gstNumber" TEXT,
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "terminals" DROP COLUMN "created_at",
DROP COLUMN "last_seen_at",
DROP COLUMN "location_id",
DROP COLUMN "row_version",
DROP COLUMN "tenant_id",
DROP COLUMN "updated_at",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "locationId" UUID,
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "tombstones" DROP COLUMN "deleted_at",
DROP COLUMN "row_id",
DROP COLUMN "table_name",
DROP COLUMN "tenant_id",
ADD COLUMN     "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "rowId" TEXT NOT NULL,
ADD COLUMN     "tableName" TEXT NOT NULL,
ADD COLUMN     "tenantId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "user_permission_overrides" DROP CONSTRAINT "user_permission_overrides_pkey",
DROP COLUMN "tenant_id",
DROP COLUMN "user_id",
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "userId" UUID NOT NULL,
ADD CONSTRAINT "user_permission_overrides_pkey" PRIMARY KEY ("userId", "permission");

-- AlterTable
ALTER TABLE "users" DROP COLUMN "created_at",
DROP COLUMN "password_hash",
DROP COLUMN "role_id",
DROP COLUMN "row_version",
DROP COLUMN "tenant_id",
DROP COLUMN "updated_at",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "passwordHash" TEXT NOT NULL,
ADD COLUMN     "roleId" UUID,
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "wallet_ledger" DROP COLUMN "bill_id",
DROP COLUMN "created_at",
DROP COLUMN "customer_id",
DROP COLUMN "op_id",
DROP COLUMN "reverses_id",
DROP COLUMN "tenant_id",
DROP COLUMN "terminal_id",
ADD COLUMN     "billId" UUID,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "customerId" UUID NOT NULL,
ADD COLUMN     "opId" UUID NOT NULL,
ADD COLUMN     "reversesId" UUID,
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "terminalId" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "appointments_tenantId_startAt_idx" ON "appointments"("tenantId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_tenantId_staffId_date_key" ON "attendance"("tenantId", "staffId", "date");

-- CreateIndex
CREATE INDEX "audit_log_tenantId_at_idx" ON "audit_log"("tenantId", "at");

-- CreateIndex
CREATE INDEX "bill_lines_billId_idx" ON "bill_lines"("billId");

-- CreateIndex
CREATE INDEX "bills_tenantId_createdAt_idx" ON "bills"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "bills_tenantId_opId_key" ON "bills"("tenantId", "opId");

-- CreateIndex
CREATE UNIQUE INDEX "bills_tenantId_series_invoiceNo_key" ON "bills"("tenantId", "series", "invoiceNo");

-- CreateIndex
CREATE INDEX "customer_packages_tenantId_customerId_idx" ON "customer_packages"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "customers_tenantId_idx" ON "customers"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenantId_phone_key" ON "customers"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "expenses_tenantId_date_idx" ON "expenses"("tenantId", "date");

-- CreateIndex
CREATE INDEX "locations_tenantId_idx" ON "locations"("tenantId");

-- CreateIndex
CREATE INDEX "memberships_tenantId_idx" ON "memberships"("tenantId");

-- CreateIndex
CREATE INDEX "package_items_tenantId_idx" ON "package_items"("tenantId");

-- CreateIndex
CREATE INDEX "packages_tenantId_idx" ON "packages"("tenantId");

-- CreateIndex
CREATE INDEX "payments_billId_idx" ON "payments"("billId");

-- CreateIndex
CREATE INDEX "processed_ops_tenantId_idx" ON "processed_ops"("tenantId");

-- CreateIndex
CREATE INDEX "products_tenantId_idx" ON "products"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_tenantId_userId_idx" ON "refresh_tokens"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "resources_tenantId_idx" ON "resources"("tenantId");

-- CreateIndex
CREATE INDEX "roles_tenantId_idx" ON "roles"("tenantId");

-- CreateIndex
CREATE INDEX "service_categories_tenantId_idx" ON "service_categories"("tenantId");

-- CreateIndex
CREATE INDEX "services_tenantId_idx" ON "services"("tenantId");

-- CreateIndex
CREATE INDEX "session_ledger_tenantId_customerId_idx" ON "session_ledger"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "site_media_tenantId_idx" ON "site_media"("tenantId");

-- CreateIndex
CREATE INDEX "site_sections_tenantId_position_idx" ON "site_sections"("tenantId", "position");

-- CreateIndex
CREATE INDEX "staff_tenantId_idx" ON "staff"("tenantId");

-- CreateIndex
CREATE INDEX "stock_ledger_tenantId_productId_idx" ON "stock_ledger"("tenantId", "productId");

-- CreateIndex
CREATE INDEX "sync_exceptions_tenantId_status_idx" ON "sync_exceptions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "terminals_tenantId_idx" ON "terminals"("tenantId");

-- CreateIndex
CREATE INDEX "tombstones_tenantId_deletedAt_idx" ON "tombstones"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "user_permission_overrides_tenantId_idx" ON "user_permission_overrides"("tenantId");

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_phone_key" ON "users"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "wallet_ledger_tenantId_customerId_idx" ON "wallet_ledger"("tenantId", "customerId");
