import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50">
      <div className="w-full max-w-md space-y-8 p-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">CGT-Sync</h1>
          <p className="mt-2 text-sm text-zinc-500">Financial & Scope Governance for Biopharma</p>
          <p className="mt-1 text-xs text-zinc-400">Sponsor ↔ CDMO Program Management</p>
        </div>
        <div className="flex flex-col gap-3">
          <Link
            href="/login"
            className="flex h-11 items-center justify-center rounded-md bg-zinc-900 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Sign In
          </Link>
          <Link
            href="/signup"
            className="flex h-11 items-center justify-center rounded-md border border-zinc-300 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Create Account
          </Link>
        </div>
      </div>
    </div>
  );
}
