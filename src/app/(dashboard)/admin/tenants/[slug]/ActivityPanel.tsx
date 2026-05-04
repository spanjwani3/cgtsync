import Link from "next/link";
import AuditEventRow, {
  type AuditEntry,
} from "@/components/audit/AuditEventRow";
import type { TenantSnapshot } from "@/lib/server/admin/tenantSnapshot";

interface Props {
  orgId: string;
  activity: TenantSnapshot["activity"];
}

export default function ActivityPanel({ orgId, activity }: Props) {
  const entries: AuditEntry[] = activity.map((e) => ({
    id: e.id,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    metadata: e.metadata,
    ipAddress: e.ipAddress,
    createdAt: e.createdAt.toISOString(),
    user: e.user ? { email: e.user.email } : null,
    program: e.program,
  }));

  return (
    <div className="card p-0">
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
        <h2 className="text-sm font-semibold text-zinc-900">Recent activity</h2>
        <Link
          href={`/admin/activity?orgId=${orgId}`}
          className="text-xs text-accent-text underline"
        >
          View full activity →
        </Link>
      </div>
      {entries.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">No events recorded yet.</p>
      ) : (
        <div className="divide-y divide-zinc-100">
          {entries.map((e) => (
            <AuditEventRow key={e.id} entry={e} showProgram />
          ))}
        </div>
      )}
    </div>
  );
}
