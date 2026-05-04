import { formatCompact } from "@/lib/format";
import type { TenantSnapshot } from "@/lib/server/admin/tenantSnapshot";

interface Props {
  programs: TenantSnapshot["programs"];
}

function statusPill(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "bg-green-100 text-green-700";
    case "ARCHIVED":
      return "bg-zinc-100 text-zinc-500";
    default:
      return "bg-zinc-100 text-zinc-600";
  }
}

function baselinePill(status: string | undefined): string {
  if (status === "LOCKED") return "bg-blue-100 text-blue-700";
  if (status === "RELEASED" || status === "CONFIRMED")
    return "bg-purple-100 text-purple-700";
  return "bg-zinc-100 text-zinc-600";
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

export default function ProgramsPanel({ programs }: Props) {
  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900">
          Programs ({programs.length})
        </h2>
      </div>
      {programs.length === 0 ? (
        <p className="text-sm text-muted">
          This tenant hasn&apos;t created any programs yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-[11px] font-medium uppercase tracking-wide text-muted">
                <th className="py-2 pr-3">Program</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Baseline</th>
                <th className="py-2 pr-3 text-right">$ flagged</th>
                <th className="py-2 pr-3 text-right">$ disputed</th>
                <th className="py-2 pr-3 text-right">Open alerts</th>
                <th className="py-2 pr-3">Last invoice</th>
                <th className="py-2 pr-3">Last evidence</th>
              </tr>
            </thead>
            <tbody>
              {programs.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-zinc-100 last:border-b-0"
                >
                  <td className="py-2 pr-3">
                    <p className="font-medium text-zinc-900">{p.name}</p>
                    <p className="text-[11px] text-muted">
                      {p.cdmoName}
                      {p.modality ? ` · ${p.modality}` : ""}
                    </p>
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${statusPill(p.status)}`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    {p.baseline ? (
                      <span
                        className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${baselinePill(p.baseline.status)}`}
                      >
                        v{p.baseline.version} · {p.baseline.status}
                      </span>
                    ) : (
                      <span className="text-xs text-muted">none</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-xs text-zinc-700">
                    {p.money.flagged > 0
                      ? formatCompact(p.money.flagged, p.currency)
                      : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-xs text-zinc-700">
                    {p.money.disputed > 0
                      ? formatCompact(p.money.disputed, p.currency)
                      : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right text-xs text-zinc-700">
                    {p.counts.openScopeAlerts > 0
                      ? p.counts.openScopeAlerts
                      : "—"}
                  </td>
                  <td className="py-2 pr-3 text-xs text-zinc-700">
                    {fmtDate(p.lastInvoiceAt)}
                  </td>
                  <td className="py-2 pr-3 text-xs text-zinc-700">
                    {fmtDate(p.lastEvidenceUploadAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
