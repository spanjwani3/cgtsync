"use client";

import Link from "next/link";

const ITEMS = [
  { key: "activity", label: "Activity", href: "/admin/activity" },
  { key: "tenants", label: "Tenants", href: "/admin/tenants" },
  { key: "health", label: "Health", href: "/admin/health" },
] as const;

export default function AdminNav({
  active,
}: {
  active: "activity" | "tenants" | "health";
}) {
  return (
    <nav className="flex items-center gap-1 border-b border-zinc-200 pb-2 text-sm">
      <span className="mr-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Platform admin
      </span>
      {ITEMS.map((item) => {
        const isActive = item.key === active;
        return (
          <Link
            key={item.key}
            href={item.href}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              isActive
                ? "bg-zinc-900 text-white"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
