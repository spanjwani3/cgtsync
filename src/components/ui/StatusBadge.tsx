const statusColors: Record<string, string> = {
  DRAFT: "bg-zinc-100 text-zinc-600",
  RELEASED: "bg-blue-100 text-blue-700",
  CONFIRMED: "bg-green-100 text-green-700",
  LOCKED: "bg-purple-100 text-purple-700",
  SUPERSEDED: "bg-zinc-200 text-zinc-500",
  ACTIVE: "bg-green-100 text-green-700",
  ARCHIVED: "bg-zinc-100 text-zinc-500",
  UPLOADED: "bg-blue-50 text-blue-600",
  MAPPED: "bg-blue-100 text-blue-700",
  FLAGGED: "bg-red-100 text-red-700",
  APPROVED: "bg-green-100 text-green-700",
  DISPUTED: "bg-red-100 text-red-700",
  LOGGED: "bg-green-50 text-green-600",
  LOW: "bg-green-50 text-green-600",
  MEDIUM: "bg-amber-50 text-amber-600",
  HIGH: "bg-orange-100 text-orange-700",
  CRITICAL: "bg-red-100 text-red-700",
  NONE: "bg-zinc-50 text-zinc-400",
  RATE_MISMATCH: "bg-red-100 text-red-700",
  SCOPE_CREEP: "bg-orange-100 text-orange-700",
  UNAPPROVED_CHANGE: "bg-red-100 text-red-700",
  DUPLICATE: "bg-amber-100 text-amber-700",
  MISSING_BASELINE: "bg-amber-100 text-amber-700",
  PRICING: "bg-emerald-50 text-emerald-700",
  TIMELINE: "bg-blue-50 text-blue-700",
  SCOPE: "bg-violet-50 text-violet-700",
  QUALITY: "bg-cyan-50 text-cyan-700",
  REGULATORY: "bg-rose-50 text-rose-700",
  PAYMENT_TERMS: "bg-amber-50 text-amber-700",
  IP: "bg-indigo-50 text-indigo-700",
  OTHER: "bg-zinc-100 text-zinc-600",
  INVOICE: "bg-emerald-50 text-emerald-600",
  SOW_MSA: "bg-blue-50 text-blue-600",
  EMAIL_APPROVAL: "bg-violet-50 text-violet-600",
  TRANSCRIPT: "bg-cyan-50 text-cyan-600",
  CHANGE_ORDER: "bg-amber-50 text-amber-600",
};

export default function StatusBadge({
  status,
  confirmationMode,
}: {
  status: string;
  confirmationMode?: string | null;
}) {
  // Shadow confirmation: distinct dashed-border style
  if (status === "CONFIRMED" && confirmationMode === "SHADOW") {
    return (
      <span className="inline-flex rounded-full border border-dashed border-green-400 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
        Confirmed (Shadow)
      </span>
    );
  }

  const colors = statusColors[status] ?? "bg-zinc-100 text-zinc-600";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${colors}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
