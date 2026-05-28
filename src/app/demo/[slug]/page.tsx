import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Logo } from "@/components/brand/Logo";
import { getDemo } from "@/lib/demo/catalog";
import { verifyAccess, accessCookieName } from "@/lib/demo/access-token";
import { getDemoVideoSignedUrl } from "@/lib/server/storage";
import { DemoGate } from "@/components/demo/DemoGate";
import { DemoPlayer } from "@/components/demo/DemoPlayer";

export const dynamic = "force-dynamic";

// Keep these gated pages out of search engines.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function DemoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const demo = getDemo(slug);

  if (!demo) {
    return (
      <Shell>
        <Logo size={56} variant="dark" />
        <h1 className="mt-6 text-2xl font-bold text-white">Demo not found</h1>
        <p className="mt-2 max-w-sm text-center text-sm text-slate-400">
          This link is no longer available. Please check with your CGT Sync
          contact for an up-to-date link.
        </p>
      </Shell>
    );
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(accessCookieName(slug))?.value;
  const access = verifyAccess(token, slug);

  if (access) {
    let videoUrl: string | null = null;
    let error: string | null = null;
    try {
      videoUrl = await getDemoVideoSignedUrl(demo.storagePath);
    } catch {
      error =
        "The video is temporarily unavailable. Please try again in a moment.";
    }

    return (
      <Shell wide>
        {videoUrl ? (
          <DemoPlayer slug={slug} videoUrl={videoUrl} demo={demo} />
        ) : (
          <>
            <Logo size={48} variant="dark" />
            <p className="mt-6 max-w-sm text-center text-sm text-slate-400">
              {error}
            </p>
          </>
        )}
      </Shell>
    );
  }

  return (
    <Shell>
      <DemoGate slug={slug} demo={demo} />
    </Shell>
  );
}

function Shell({
  children,
  wide,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-navy px-4 py-12">
      <div
        className={`flex w-full flex-col items-center ${wide ? "max-w-3xl" : "max-w-md"}`}
      >
        {children}
      </div>
    </div>
  );
}
