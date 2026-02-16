"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/* ───── SVG icon components ───── */

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function LayoutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="21" x2="9" y2="9" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function GitBranchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

function DollarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function LogOutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

/* ───── Nav config ───── */

const PROGRAM_NAV = [
  { key: "cockpit", label: "Cockpit", icon: LayoutIcon },
  { key: "baseline", label: "Baseline Truth", icon: LockIcon },
  { key: "changes", label: "Change Events", icon: GitBranchIcon },
  { key: "invoices", label: "Reconciliation", icon: DollarIcon },
  { key: "evidence", label: "Evidence Log", icon: FileIcon },
  { key: "timeline", label: "Commitment Timeline", icon: ClockIcon },
  { key: "exports", label: "Export Center", icon: DownloadIcon },
];

/* ───── Component ───── */

interface SidebarProps {
  orgName: string;
  userEmail: string;
  userName?: string;
  currentProgram?: { id: string; name: string; molecule?: string | null } | null;
}

export default function Sidebar({ orgName, userEmail, userName, currentProgram }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initials = (userName || userEmail || "U")
    .split(/[\s@]+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col bg-sidebar-bg">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2.5 px-5">
        <ShieldIcon className="h-6 w-6 text-sidebar-active" />
        <Link href="/programs" className="text-base font-bold tracking-tight text-sidebar-text-bright">
          CGT-Sync
        </Link>
      </div>

      {/* Current Program */}
      {currentProgram ? (
        <div className="border-t border-b border-sidebar-border px-5 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-text">Current Program</p>
          <p className="mt-1 truncate text-sm font-medium text-sidebar-text-bright">{currentProgram.name}</p>
          {currentProgram.molecule && (
            <p className="truncate text-xs text-sidebar-text">{currentProgram.molecule}</p>
          )}
        </div>
      ) : (
        <div className="border-t border-sidebar-border" />
      )}

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
        {currentProgram ? (
          <>
            {PROGRAM_NAV.map((item) => {
              const href = `/programs/${currentProgram.id}/${item.key}`;
              const active = pathname.startsWith(href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.key}
                  href={href}
                  className={`flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${
                    active
                      ? "bg-sidebar-active font-medium text-white"
                      : "text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-bright"
                  }`}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  {item.label}
                </Link>
              );
            })}
            <div className="mt-4 border-t border-sidebar-border pt-3">
              <Link
                href="/programs"
                className="flex h-9 items-center gap-3 rounded-lg px-3 text-sm text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-bright"
              >
                <FolderIcon className="h-4 w-4 flex-shrink-0" />
                All Programs
              </Link>
              <Link
                href="/onboarding"
                className="flex h-9 items-center gap-3 rounded-lg px-3 text-sm text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-bright"
              >
                <PlusIcon className="h-4 w-4 flex-shrink-0" />
                New Program
              </Link>
            </div>
          </>
        ) : (
          <>
            <Link
              href="/programs"
              className={`flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${
                pathname === "/programs"
                  ? "bg-sidebar-active font-medium text-white"
                  : "text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-bright"
              }`}
            >
              <FolderIcon className="h-4 w-4 flex-shrink-0" />
              Programs
            </Link>
            <Link
              href="/onboarding"
              className={`flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${
                pathname.startsWith("/onboarding")
                  ? "bg-sidebar-active font-medium text-white"
                  : "text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-bright"
              }`}
            >
              <PlusIcon className="h-4 w-4 flex-shrink-0" />
              New Program
            </Link>
          </>
        )}
      </nav>

      {/* User section */}
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-sidebar-active text-xs font-bold text-white">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            {userName && <p className="truncate text-sm font-medium text-sidebar-text-bright">{userName}</p>}
            <p className="truncate text-xs text-sidebar-text">{userEmail}</p>
          </div>
        </div>
        <p className="mt-1 truncate px-2 text-[10px] font-medium uppercase tracking-wider text-sidebar-text">{orgName}</p>
        <button
          onClick={handleLogout}
          className="mt-2 flex h-8 w-full items-center justify-center gap-2 rounded-lg text-xs font-medium text-sidebar-text transition-colors hover:bg-sidebar-hover hover:text-sidebar-text-bright"
        >
          <LogOutIcon className="h-3.5 w-3.5" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
