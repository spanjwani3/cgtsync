"use client";

import { useState, useEffect } from "react";
import PmDashboard from "@/components/dashboard/PmDashboard";
import PortfolioDashboard from "@/components/dashboard/PortfolioDashboard";
import ExecutiveDashboard from "@/components/dashboard/ExecutiveDashboard";

export default function DashboardPage() {
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"portfolio" | "executive">("portfolio");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setRole(data.role);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-sm text-muted">
          <svg className="h-5 w-5 animate-spin text-accent" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          Loading...
        </div>
      </div>
    );
  }

  // OPERATOR → PM Dashboard
  if (role === "OPERATOR") {
    return <PmDashboard />;
  }

  // ADMIN → Portfolio/Executive tab switcher
  if (role === "ADMIN") {
    return (
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-zinc-900">Dashboard</h1>
          <div className="flex rounded-lg bg-zinc-100 p-0.5">
            <button
              onClick={() => setActiveTab("portfolio")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === "portfolio" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              Portfolio
            </button>
            <button
              onClick={() => setActiveTab("executive")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === "executive" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              Executive
            </button>
          </div>
        </div>
        {activeTab === "portfolio" ? <PortfolioDashboard /> : <ExecutiveDashboard />}
      </div>
    );
  }

  // READ_ONLY → Portfolio (no actions)
  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-900">Dashboard</h1>
      <PortfolioDashboard readOnly />
    </div>
  );
}
