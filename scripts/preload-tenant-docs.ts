/**
 * Preload contract documents for a tenant by uploading PDFs to Supabase
 * Storage, creating Evidence rows, and running extraction. Leaves resulting
 * data in extractionJob.extractedData; Samir reviews in the UI and clicks
 * "Apply" to create the Baseline / Change records.
 *
 * Usage:
 *   npx tsx scripts/preload-tenant-docs.ts \
 *     --slug cellipont \
 *     --program "Cellipont — CDMO Manufacturing" \
 *     --dir scripts/tenant-seed-docs/cellipont \
 *     [--actor <samir-user-id>]
 *
 * Files in --dir are classified by filename prefix:
 *   base-contract* / msa* / sow*  → SOW_MSA  → BASELINE extraction
 *   co-* / change-order-* / amendment-* → CHANGE_ORDER  → CHANGE_ORDER extraction
 */

import { PrismaClient, ExtractionTargetType, EvidenceType } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { uploadEvidence, ensureBucketExists } from "../src/lib/server/storage";
import { runExtraction } from "../src/lib/server/extraction";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient({
  adapter: new PrismaPg(
    new Pool({
      connectionString:
        process.env.DATABASE_URL ?? process.env.DIRECT_URL ?? "",
    }),
  ),
});

interface Args {
  slug: string;
  program: string;
  dir: string;
  actor: string | null;
}

function parseArgs(argv: string[]): Args {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = "true";
    } else {
      out[key] = next;
      i++;
    }
  }
  for (const k of ["slug", "program", "dir"]) {
    if (!out[k]) throw new Error(`Missing required arg --${k}`);
  }
  return {
    slug: out.slug.trim().toLowerCase(),
    program: out.program.trim(),
    dir: out.dir,
    actor: out.actor ?? null,
  };
}

interface Classification {
  evidenceType: EvidenceType;
  target: ExtractionTargetType;
}

function classify(fileName: string): Classification | null {
  const lower = fileName.toLowerCase();
  if (
    lower.startsWith("base-contract") ||
    lower.startsWith("msa") ||
    lower.startsWith("sow") ||
    lower.includes("master-service") ||
    lower.includes("master_service")
  ) {
    return { evidenceType: "SOW_MSA", target: "BASELINE" };
  }
  if (
    lower.startsWith("co-") ||
    lower.startsWith("co_") ||
    lower.startsWith("change-order") ||
    lower.startsWith("change_order") ||
    lower.startsWith("amendment")
  ) {
    return { evidenceType: "CHANGE_ORDER", target: "CHANGE_ORDER" };
  }
  return null;
}

function mimeFromExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".txt") return "text/plain";
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const bucket = await ensureBucketExists();
  if (bucket.error) {
    throw new Error(`Storage bucket: ${bucket.error}`);
  }

  const org = await prisma.organization.findUnique({ where: { slug: args.slug } });
  if (!org) throw new Error(`No org found for slug "${args.slug}". Run onboard-tenant.ts first.`);

  const program = await prisma.program.findFirst({
    where: { orgId: org.id, name: args.program },
  });
  if (!program) {
    throw new Error(`No program "${args.program}" in org "${args.slug}".`);
  }

  const absDir = path.resolve(args.dir);
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
    throw new Error(`Directory not found: ${absDir}`);
  }

  const files = fs.readdirSync(absDir).filter((f) => !f.startsWith("."));
  if (!files.length) {
    console.log(`No files in ${absDir}. Nothing to do.`);
    return;
  }

  console.log(`Tenant:  ${org.name} (${org.slug})`);
  console.log(`Program: ${program.name} (${program.id})`);
  console.log(`Loading ${files.length} file(s) from ${absDir}\n`);

  for (const fileName of files) {
    const cls = classify(fileName);
    if (!cls) {
      console.log(`  SKIP ${fileName} — could not classify (rename with base-contract*, co-*, etc.)`);
      continue;
    }

    const filePath = path.join(absDir, fileName);
    const buffer = fs.readFileSync(filePath);
    const mimeType = mimeFromExt(filePath);

    const storageKey = `programs/${program.id}/preload/${Date.now()}-${fileName}`;
    const uploaded = await uploadEvidence(buffer, storageKey, mimeType);

    const evidence = await prisma.evidence.create({
      data: {
        programId: program.id,
        type: cls.evidenceType,
        fileName,
        fileSize: uploaded.fileSize,
        mimeType,
        storagePath: uploaded.storagePath,
        sha256Hash: uploaded.sha256Hash,
        metadata: { source: "preload-tenant-docs", originalPath: filePath },
      },
    });

    await prisma.eventLog.create({
      data: {
        programId: program.id,
        userId: args.actor,
        action: "EVIDENCE_UPLOADED",
        entityType: "Evidence",
        entityId: evidence.id,
        metadata: { source: "preload", fileName, evidenceType: cls.evidenceType },
      },
    });

    const job = await prisma.extractionJob.create({
      data: {
        evidenceId: evidence.id,
        programId: program.id,
        targetType: cls.target,
        status: "PROCESSING",
        startedAt: new Date(),
      },
    });

    const startMs = Date.now();
    try {
      const result = await runExtraction(
        evidence.storagePath,
        mimeType,
        cls.target,
        evidence.id,
      );

      await prisma.extractionJob.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          extractedData: result.extractedData as object,
          confidence: result.confidence,
          tokensUsed: result.tokensUsed,
          modelUsed: result.modelUsed,
          processingTimeMs: Date.now() - startMs,
          completedAt: new Date(),
        },
      });

      await prisma.eventLog.create({
        data: {
          programId: program.id,
          userId: args.actor,
          action: "EXTRACTION_JOB_SUCCEEDED",
          entityType: "ExtractionJob",
          entityId: job.id,
          metadata: {
            source: "preload",
            target: cls.target,
            confidence: result.confidence,
            tokensUsed: result.tokensUsed,
          },
        },
      });

      console.log(
        `  OK   ${fileName} → ${cls.target} (confidence ${result.confidence.toFixed(2)}, ${result.tokensUsed} tokens, ${Date.now() - startMs}ms)`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.extractionJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          errorMessage: msg,
          processingTimeMs: Date.now() - startMs,
          completedAt: new Date(),
        },
      });
      await prisma.eventLog.create({
        data: {
          programId: program.id,
          userId: args.actor,
          action: "EXTRACTION_JOB_FAILED",
          entityType: "ExtractionJob",
          entityId: job.id,
          metadata: { source: "preload", target: cls.target, error: msg },
        },
      });
      console.log(`  FAIL ${fileName} → ${cls.target}: ${msg}`);
    }
  }

  console.log("\nDone. Review extraction output in the app, then Apply to create Baseline / Change records.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
