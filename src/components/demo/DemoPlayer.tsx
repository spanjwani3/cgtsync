"use client";

import { useEffect, useRef } from "react";
import { Logo } from "@/components/brand/Logo";
import type { Demo } from "@/lib/demo/catalog";

const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Branded embedded video player. Tracks real play time (ignoring seeks) and
 * sends periodic heartbeats so admin analytics can show watch time and
 * completion. Heartbeats are fire-and-forget — failures are silent.
 */
export function DemoPlayer({
  slug,
  videoUrl,
  demo,
}: {
  slug: string;
  videoUrl: string;
  demo: Demo;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Accumulated real play time (seconds), advanced only while playing.
  const watchedRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const endpoint = `/api/demo/${slug}/heartbeat`;

    function buildPayload() {
      const v = videoRef.current;
      return JSON.stringify({
        watchedSeconds: watchedRef.current,
        positionSeconds: v?.currentTime ?? 0,
        durationSeconds: v && isFinite(v.duration) ? v.duration : undefined,
      });
    }

    function send() {
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: buildPayload(),
        keepalive: true,
      }).catch(() => {});
    }

    function onTimeUpdate() {
      const v = videoRef.current;
      if (!v) return;
      const last = lastTimeRef.current;
      // Count forward progress during normal playback; ignore seeks/jumps.
      if (last != null) {
        const delta = v.currentTime - last;
        if (delta > 0 && delta < 2) watchedRef.current += delta;
      }
      lastTimeRef.current = v.currentTime;
    }

    function onPause() {
      send();
    }
    function onEnded() {
      send();
    }
    function onBeforeUnload() {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          endpoint,
          new Blob([buildPayload()], { type: "application/json" }),
        );
      }
    }

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    window.addEventListener("beforeunload", onBeforeUnload);
    const interval = window.setInterval(send, HEARTBEAT_INTERVAL_MS);

    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.clearInterval(interval);
      send();
    };
  }, [slug]);

  return (
    <div className="flex w-full flex-col items-center">
      <div className="mb-6 flex items-center gap-3">
        <Logo size={36} variant="dark" />
        <div>
          <h1 className="text-lg font-bold leading-tight text-white">
            {demo.title}
          </h1>
          <p className="text-xs text-slate-400">{demo.subtitle}</p>
        </div>
      </div>

      <video
        ref={videoRef}
        src={videoUrl}
        controls
        autoPlay
        playsInline
        controlsList="nodownload"
        onContextMenu={(e) => e.preventDefault()}
        className="w-full overflow-hidden rounded-xl border border-slate-700 bg-black shadow-2xl"
      />

      <p className="mt-6 text-center text-sm text-slate-400">
        Want to see CGT Sync on your own programs?{" "}
        <a
          href="mailto:samir@cgtsync.ai?subject=CGT%20Sync%20demo%20follow-up"
          className="font-medium text-accent hover:text-accent-hover"
        >
          Get in touch
        </a>
        .
      </p>
    </div>
  );
}
