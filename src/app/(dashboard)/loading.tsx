import { Logo } from "@/components/brand/Logo";

export default function DashboardLoading() {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="brand-pulse">
        <Logo size={48} variant="light" />
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-widest text-muted">
        CGT Sync
      </p>
      <p className="mt-1 text-sm text-zinc-600">Loading your workspace…</p>
    </div>
  );
}
