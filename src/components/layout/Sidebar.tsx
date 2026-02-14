"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface NavItem {
  label: string;
  href: string;
  icon?: string;
}

interface SidebarProps {
  orgName: string;
  userEmail: string;
  navigation: NavItem[];
}

export default function Sidebar({ orgName, userEmail, navigation }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-sidebar-border bg-sidebar-bg">
      {/* Logo */}
      <div className="flex h-14 items-center border-b border-sidebar-border px-5">
        <Link href="/programs" className="text-base font-bold tracking-tight text-zinc-900">
          CGT-Sync
        </Link>
      </div>

      {/* Org name */}
      <div className="border-b border-sidebar-border px-5 py-2">
        <p className="truncate text-xs font-medium text-zinc-500">{orgName}</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
        {navigation.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex h-9 items-center rounded-md px-3 text-sm transition-colors ${
                active
                  ? "bg-zinc-900 font-medium text-white"
                  : "text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="border-t border-sidebar-border p-3">
        <p className="truncate px-2 text-xs text-zinc-500">{userEmail}</p>
        <button
          onClick={handleLogout}
          className="mt-2 flex h-8 w-full items-center justify-center rounded-md border border-zinc-300 text-xs font-medium text-zinc-600 hover:bg-zinc-100"
        >
          Sign Out
        </button>
      </div>
    </aside>
  );
}
