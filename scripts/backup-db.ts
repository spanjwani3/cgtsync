#!/usr/bin/env npx tsx
/**
 * Self-serve database backup. Runs pg_dump against DIRECT_URL and writes
 * a timestamped, gzipped SQL file to ./backups/.
 *
 * Usage:
 *   npm run db:backup
 *
 * Why this exists:
 *   On Supabase Free tier, restoring from Supabase's daily snapshot requires
 *   a support ticket (not self-serve). This gives us a backup we own and can
 *   replay anywhere with `psql`. See docs/RUNBOOK.md for the full procedure.
 */

import "dotenv/config";
import { spawn } from "child_process";
import { createWriteStream, mkdirSync, statSync, unlinkSync } from "fs";
import { resolve } from "path";

function fail(msg: string): never {
  console.error(`[backup-db] ${msg}`);
  process.exit(1);
}

const url = process.env.DIRECT_URL;
if (!url) {
  fail("DIRECT_URL is required (direct Postgres connection, port 5432, not the pooler).");
}
if (url.includes(":6543")) {
  fail("DIRECT_URL points at the pooler (port 6543). pg_dump needs the direct connection on port 5432.");
}

const stamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
const outDir = resolve(process.cwd(), "backups");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, `cgtsync-${stamp}.sql.gz`);

console.log(`[backup-db] dumping to ${outPath}`);

const dump = spawn(
  "pg_dump",
  [
    "--no-owner",
    "--no-acl",
    "--clean",
    "--if-exists",
    "--quote-all-identifiers",
    "--format=plain",
    url,
  ],
  { stdio: ["ignore", "pipe", "inherit"] },
);

const gzip = spawn("gzip", ["-9"], { stdio: ["pipe", "pipe", "inherit"] });
const out = createWriteStream(outPath);

dump.stdout.pipe(gzip.stdin);
gzip.stdout.pipe(out);

const dumpDone = new Promise<number>((res, rej) => {
  dump.on("error", (e) => rej(new Error(`pg_dump failed to spawn: ${e.message}`)));
  dump.on("exit", (code) => res(code ?? -1));
});

const gzipDone = new Promise<number>((res, rej) => {
  gzip.on("error", (e) => rej(new Error(`gzip failed to spawn: ${e.message}`)));
  gzip.on("exit", (code) => res(code ?? -1));
});

const writeDone = new Promise<void>((res, rej) => {
  out.on("error", rej);
  out.on("finish", res);
});

async function main() {
  const [dumpCode, gzipCode] = await Promise.all([dumpDone, gzipDone]);
  await writeDone;
  if (dumpCode !== 0) {
    try { unlinkSync(outPath); } catch {}
    fail(`pg_dump exited with code ${dumpCode}. Output file removed.`);
  }
  if (gzipCode !== 0) {
    try { unlinkSync(outPath); } catch {}
    fail(`gzip exited with code ${gzipCode}. Output file removed.`);
  }
  const size = statSync(outPath).size;
  console.log(`[backup-db] OK → ${outPath} (${(size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`[backup-db] Restore: gunzip -c ${outPath} | psql "$DIRECT_URL"`);
}

main().catch((e) => {
  try { unlinkSync(outPath); } catch {}
  fail(e instanceof Error ? e.message : String(e));
});
