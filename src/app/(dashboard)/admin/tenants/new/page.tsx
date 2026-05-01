import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/server/auth";
import NewTenantForm from "./NewTenantForm";

export const dynamic = "force-dynamic";

export default async function NewTenantPage() {
  try {
    await requirePlatformAdmin();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "UNAUTHORIZED") redirect("/login");
    redirect("/programs");
  }

  const rootDomain = process.env.ROOT_DOMAIN ?? "cgtsync.ai";
  return <NewTenantForm rootDomain={rootDomain} />;
}
