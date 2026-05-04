import type { TenantSnapshot } from "@/lib/server/admin/tenantSnapshot";

interface Props {
  health: TenantSnapshot["health"];
}

function relTime(d: Date | null): string {
  if (!d) return "—";
  const days = Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
  if (days < 1) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1mo ago" : `${months}mo ago`;
}

export default function HealthSignals({ health }: Props) {
  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-zinc-900">Health</h2>

      <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
        <div>
          <p className="text-muted">Last evidence upload</p>
          <p className="mt-0.5 font-medium text-zinc-700">
            {relTime(health.lastEvidenceUploadAt)}
          </p>
        </div>
        <div>
          <p className="text-muted">Last baseline locked</p>
          <p className="mt-0.5 font-medium text-zinc-700">
            {relTime(health.lastBaselineLockedAt)}
          </p>
        </div>
        <div>
          <p className="text-muted">Last invoice</p>
          <p className="mt-0.5 font-medium text-zinc-700">
            {relTime(health.lastInvoiceAt)}
          </p>
        </div>
      </div>

      <div className="mt-4 border-t border-zinc-200 pt-3">
        {health.stuckSignals.length === 0 ? (
          <p className="text-xs text-muted">Nothing flagged — looks healthy.</p>
        ) : (
          <ul className="space-y-1.5">
            {health.stuckSignals.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <span
                  className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                    s.severity === "warn" ? "bg-amber-500" : "bg-zinc-400"
                  }`}
                  aria-hidden
                />
                <span className="text-zinc-700">{s.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
