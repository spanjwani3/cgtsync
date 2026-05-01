/**
 * Safe select for Change queries that works regardless of whether the
 * reason_code / schedule_impact_days / confirmation_mode migration has been applied.
 *
 * Prisma's generated client includes ALL model fields in implicit SELECTs.
 * If the DB is behind the schema, queries fail with "column does not exist".
 * Using explicit `select` avoids this.
 */
export const CHANGE_BASE_SELECT = {
  id: true,
  programId: true,
  baselineId: true,
  evidenceFileId: true,
  sequenceNum: true,
  title: true,
  description: true,
  severity: true,
  status: true,
  estimatedImpact: true,
  releasedAt: true,
  confirmedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * All four extended columns that must exist for the extended select.
 */
const EXTENDED_COLUMNS = ["reason_code", "schedule_impact_days", "confirmation_mode", "counterparty_note"] as const;

/**
 * Extended select that includes post-migration columns.
 * Only use this after confirming ALL extended columns exist.
 */
export const CHANGE_EXTENDED_SELECT = {
  ...CHANGE_BASE_SELECT,
  reasonCode: true,
  scheduleImpactDays: true,
  confirmationMode: true,
  counterpartyNote: true,
} as const;

/**
 * Use in place of `change: true` inside Prisma `include` blocks.
 * e.g., `include: { clause: true, change: CHANGE_INCLUDE_SELECT }`
 */
export const CHANGE_INCLUDE_SELECT = { select: CHANGE_BASE_SELECT } as const;

let _migrationApplied: boolean | null = null;

/**
 * Detects at runtime whether ALL extended change columns exist in the database.
 * Uses information_schema for reliable detection (works with any Prisma adapter).
 * Result is cached per server lifecycle (per cold start on Vercel).
 */
export async function hasChangeExtendedColumns(prisma: { $queryRawUnsafe: (q: string) => Promise<unknown> }): Promise<boolean> {
  if (_migrationApplied !== null) return _migrationApplied;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'changes' AND column_name IN ('reason_code', 'schedule_impact_days', 'confirmation_mode', 'counterparty_note')`
    ) as Array<{ column_name: string }>;
    _migrationApplied = rows.length === EXTENDED_COLUMNS.length;
  } catch (e) {
    console.error("Change compat detection error:", e);
    _migrationApplied = false;
  }
  return _migrationApplied;
}

/**
 * Returns the appropriate select object based on migration status.
 */
export async function getChangeSelect(prisma: { $queryRawUnsafe: (q: string) => Promise<unknown> }) {
  const extended = await hasChangeExtendedColumns(prisma);
  return extended ? CHANGE_EXTENDED_SELECT : CHANGE_BASE_SELECT;
}

/**
 * Strips extended fields from a data object if the migration hasn't been applied.
 */
export function stripExtendedFields<T extends Record<string, unknown>>(data: T, migrationApplied: boolean): T {
  if (migrationApplied) return data;
  const { reasonCode, scheduleImpactDays, confirmationMode, ...safe } = data;
  return safe as T;
}
