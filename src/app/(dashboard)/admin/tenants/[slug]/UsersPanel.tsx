import type { TenantSnapshot } from "@/lib/server/admin/tenantSnapshot";

interface Props {
  users: TenantSnapshot["users"];
}

function relTime(d: Date | null): string {
  if (!d) return "—";
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1mo ago" : `${months}mo ago`;
}

function rolePill(role: string): string {
  switch (role) {
    case "ADMIN":
      return "bg-blue-100 text-blue-700";
    case "OPERATOR":
      return "bg-zinc-100 text-zinc-700";
    case "READ_ONLY":
      return "bg-zinc-100 text-zinc-500";
    default:
      return "bg-zinc-100 text-zinc-600";
  }
}

export default function UsersPanel({ users }: Props) {
  return (
    <div className="card">
      <h2 className="mb-3 text-sm font-semibold text-zinc-900">
        Users ({users.length})
      </h2>
      {users.length === 0 ? (
        <p className="text-sm text-muted">No users.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-[11px] font-medium uppercase tracking-wide text-muted">
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Joined</th>
                <th className="py-2 pr-3">Last activity</th>
                <th className="py-2 pr-3 text-right">Events (30d)</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.userId}
                  className="border-b border-zinc-100 last:border-b-0"
                >
                  <td className="py-2 pr-3">
                    <p className="font-medium text-zinc-900">
                      {u.fullName || u.email}
                    </p>
                    {u.fullName && (
                      <p className="text-[11px] text-muted">{u.email}</p>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${rolePill(u.role)}`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-xs text-zinc-700">
                    {new Date(u.joinedAt).toLocaleDateString()}
                  </td>
                  <td className="py-2 pr-3 text-xs text-zinc-700">
                    {relTime(u.lastActivityAt)}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-xs text-zinc-700">
                    {u.eventCountLast30Days}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted">
        Last activity is derived from the audit log. Read-only users with no
        write actions will show &ldquo;—&rdquo;.
      </p>
    </div>
  );
}
