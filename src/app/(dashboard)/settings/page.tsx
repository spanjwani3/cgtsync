import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";
import SettingsForm from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  try {
    await requireAuth();
  } catch {
    redirect("/login");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <SettingsForm
      email={user.email ?? ""}
      fullName={user.user_metadata?.full_name ?? ""}
    />
  );
}
