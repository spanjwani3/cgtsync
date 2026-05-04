import { formatCompact } from "@/lib/format";
import type { TenantSnapshot } from "@/lib/server/admin/tenantSnapshot";

interface Props {
  totals: TenantSnapshot["totals"];
}

function Tile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold text-zinc-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export default function MetricsPanel({ totals }: Props) {
  const scopeAlertsTotal =
    totals.scopeAlertsOpen + totals.scopeAlertsResolvedLast30Days;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Tile
        label="$ flagged"
        value={formatCompact(totals.moneyFlagged)}
        sub="Line items under review"
      />
      <Tile
        label="$ disputed"
        value={formatCompact(totals.moneyDisputed)}
        sub="Invoices in dispute"
      />
      <Tile
        label="Scope alerts"
        value={String(scopeAlertsTotal)}
        sub={`${totals.scopeAlertsOpen} open · ${totals.scopeAlertsResolvedLast30Days} resolved (30d)`}
      />
      <Tile
        label="Invoices reviewed"
        value={String(totals.invoicesTotal)}
        sub={`${totals.invoicesFlagged} flagged · ${totals.invoicesDisputed} disputed · ${totals.invoicesApproved} approved`}
      />
    </div>
  );
}
