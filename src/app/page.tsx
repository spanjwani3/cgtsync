import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <div className="w-full max-w-md space-y-8 p-8">
        <div className="flex flex-col items-center text-center">
          <Logo size={56} variant="light" />
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-navy">CGT Sync</h1>
          <p className="mt-2 text-sm text-zinc-600">Financial &amp; Scope Governance for Biopharma</p>
          <p className="mt-1 text-xs text-zinc-400">Sponsor ↔ CDMO Program Management</p>
        </div>
        <div className="flex flex-col gap-3">
          <Link
            href="/login"
            className="flex h-11 items-center justify-center rounded-md bg-accent text-sm font-medium text-white transition-colors hover:bg-accent-hover"
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
