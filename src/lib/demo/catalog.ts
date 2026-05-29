/**
 * Catalog of gated demo videos.
 *
 * Each entry is keyed by an unguessable slug used in the public URL
 * (`/demo/<slug>`). The slug itself is the "secret" — these pages are not
 * linked from anywhere and are excluded from search indexing. Add a new demo
 * by appending an entry here; no migration is required (only captured leads
 * and view sessions live in the database).
 *
 * `storagePath` is the object key inside the private Supabase `demo` bucket
 * (see DEMO_BUCKET in src/lib/config.ts). The video is streamed via a
 * short-lived signed URL minted only after a visitor submits a business email.
 */

export interface Demo {
  /** Headline shown on the gate and player. */
  title: string;
  /** Supporting line under the headline. */
  subtitle: string;
  /** Object key inside the private demo bucket. */
  storagePath: string;
  /** MIME type of the video file. */
  contentType: string;
}

export const DEMOS: Record<string, Demo> = {
  "cdmo-7f3a2b9c4d": {
    title: "CGT Sync for CDMOs",
    subtitle:
      "Sponsor ↔ CDMO program governance — a 2-minute walkthrough.",
    storagePath: "cgt-sync-cdmo-demo.mp4",
    contentType: "video/mp4",
  },
  "sponsor-b8d4f1a9e3": {
    title: "CGT Sync for Sponsors",
    subtitle:
      "Real-time financial & scope governance across your CDMO programs — a 2-minute walkthrough.",
    storagePath: "cgt-sync-sponsor-demo.mp4",
    contentType: "video/mp4",
  },
};

/** Return the demo for a slug, or null if it doesn't exist. */
export function getDemo(slug: string): Demo | null {
  return DEMOS[slug] ?? null;
}
