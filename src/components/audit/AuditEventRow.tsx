export interface AuditEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
  user: { email: string } | null;
  program?: { id: string; name: string } | null;
}

export function formatAction(action: string): string {
  return action
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function actionColor(action: string): string {
  if (action.includes("CONFIRMED") || action.includes("LOCKED")) return "bg-green-100 text-green-700";
  if (action.includes("RELEASED")) return "bg-blue-100 text-blue-700";
  if (action.includes("FLAGGED") || action.includes("DISPUTE")) return "bg-red-100 text-red-700";
  if (action.includes("CREATED") || action.includes("UPLOADED")) return "bg-purple-100 text-purple-700";
  return "bg-zinc-100 text-zinc-600";
}

interface Props {
  entry: AuditEntry;
  showProgram?: boolean;
  showFullTimestamp?: boolean;
}

export default function AuditEventRow({ entry, showProgram = false, showFullTimestamp = false }: Props) {
  return (
    <div className="px-5 py-3">
      <div className="flex items-start justify-between gap-2">
        <span className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${actionColor(entry.action)}`}>
          {formatAction(entry.action)}
        </span>
        <span className="flex-shrink-0 text-[10px] text-zinc-400">
          {showFullTimestamp ? new Date(entry.createdAt).toLocaleString() : timeAgo(entry.createdAt)}
        </span>
      </div>
      {entry.entityType && (
        <p className="mt-1 text-xs text-zinc-600">
          {entry.entityType}
          {entry.entityId ? ` · ${entry.entityId.slice(0, 8)}...` : ""}
        </p>
      )}
      <p className="mt-0.5 text-[11px] text-zinc-400">
        {entry.user?.email ?? "System"}
        {entry.ipAddress ? ` · ${entry.ipAddress}` : ""}
        {showProgram && entry.program ? ` · ${entry.program.name}` : ""}
      </p>
    </div>
  );
}
