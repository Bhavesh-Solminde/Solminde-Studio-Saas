/**
 * The permission list. Server-enforced on every mutating route via
 * @RequiresPermission. Client-side hiding exists only so the UI isn't
 * confusing — it is never access control.
 */
export const PERMISSIONS = [
  'bill.create',
  'bill.void',
  'bill.discount',
  'bill.discount.above_10pct',
  'bill.reprint',
  'customer.view',
  'customer.edit',
  'customer.export',
  'appointment.create',
  'appointment.edit',
  'appointment.cancel',
  'inventory.view',
  'inventory.adjust',
  'inventory.purchase',
  'staff.view',
  'staff.edit',
  'attendance.mark',
  'commission.view_own',
  'commission.view_all',
  'reports.view',
  'reports.financial',
  'reports.export',
  'settings.edit',
  'settings.billing',
  'settings.features',
  'site.edit',
  'site.publish',
  'audit.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Feature keys for entitlements. A different system from permissions:
 * entitlements answer "does this SALON have Packages?" (set by us),
 * permissions answer "may this STYLIST void a bill?" (set by the owner).
 * Conflating them is a security bug.
 */
export const FEATURES = [
  'billing',
  'customers',
  'appointments',
  'inventory',
  'commissions',
  'packages',
  'memberships',
  'loyalty',
  'online_booking',
  'whatsapp_manual',
  'whatsapp_automation',
  'reports',
  'site_cms',
  'multi_location',
] as const;

export type FeatureKey = (typeof FEATURES)[number];

/** Dependencies enforced in the toggle endpoint, never only in the UI. */
export const FEATURE_DEPENDENCIES: Readonly<Record<FeatureKey, readonly FeatureKey[]>> = {
  billing: [],
  customers: [],
  appointments: ['customers'],
  inventory: [],
  commissions: ['billing'],
  packages: ['billing'],
  memberships: ['billing', 'customers'],
  loyalty: ['customers'],
  online_booking: ['appointments', 'site_cms'],
  whatsapp_manual: ['customers'],
  whatsapp_automation: ['customers'],
  reports: [],
  site_cms: [],
  multi_location: [],
};
