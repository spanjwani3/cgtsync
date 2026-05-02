import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/server/auth";
import ActivityFeed from "./ActivityFeed";

export const dynamic = "force-dynamic";

export default async function AdminActivityPage() {
  try {
    await requirePlatformAdmin();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") redirect("/login");
    redirect("/programs");
  }

  return <ActivityFeed />;
}
