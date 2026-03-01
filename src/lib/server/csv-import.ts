import * as XLSX from "xlsx";
import Papa from "papaparse";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

interface ParseResult {
  headers: string[];
  rows: Record<string, string>[];
}

type RowStatus = "valid" | "warning" | "error";

export interface ValidatedRow {
  rowIndex: number;
  status: RowStatus;
  data: Record<string, string>;
  mapped: Record<string, string | number | null>;
  errors: string[];
  warnings: string[];
}

export interface ValidationResult {
  valid: ValidatedRow[];
  warnings: ValidatedRow[];
  errors: ValidatedRow[];
  totalRows: number;
}

const INVOICE_FIELDS = [
  { key: "invoiceNumber", label: "Invoice Number", required: true },
  { key: "totalAmount", label: "Total Amount", required: true },
  { key: "invoiceDate", label: "Invoice Date", required: false },
  { key: "vendorName", label: "Vendor Name", required: false },
  { key: "currency", label: "Currency", required: false },
];

const BASELINE_FIELDS = [
  { key: "title", label: "Title", required: true },
  { key: "type", label: "Clause Type", required: false },
  { key: "value", label: "Value", required: false },
  { key: "unit", label: "Unit", required: false },
  { key: "description", label: "Description", required: false },
];

const CONTRACT_FIELDS = [
  { key: "label", label: "Label", required: true },
  { key: "termType", label: "Term Type", required: false },
  { key: "dateOrOffset", label: "Date / Offset", required: false },
  { key: "costOrPercent", label: "Cost / Percent", required: false },
  { key: "conditions", label: "Conditions", required: false },
];

export function getTargetFields(targetType: string) {
  switch (targetType) {
    case "INVOICE": return INVOICE_FIELDS;
    case "BASELINE": return BASELINE_FIELDS;
    case "CONTRACT": return CONTRACT_FIELDS;
    default: return [];
  }
}

export function parseFile(buffer: Buffer, mimeType: string): ParseResult {
  if (mimeType === "text/csv" || mimeType === "application/csv") {
    const text = buffer.toString("utf-8");
    const result = Papa.parse(text, { header: true, skipEmptyLines: true });
    return {
      headers: result.meta.fields ?? [],
      rows: result.data as Record<string, string>[],
    };
  }
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const headers = jsonData.length > 0 ? Object.keys(jsonData[0]) : [];
  const rows = jsonData.map((row) => {
    const mapped: Record<string, string> = {};
    for (const key of headers) {
      mapped[key] = String(row[key] ?? "");
    }
    return mapped;
  });
  return { headers, rows };
}

function parseDate(val: string): Date | null {
  if (!val) return null;
  const iso = new Date(val);
  if (!isNaN(iso.getTime())) return iso;
  const parts = val.split(/[\/\-]/);
  if (parts.length === 3) {
    const [a, b, c] = parts;
    if (Number(c) > 100) {
      const d = new Date(Number(c), Number(a) - 1, Number(b));
      if (!isNaN(d.getTime())) return d;
    }
    if (Number(a) > 100) {
      const d = new Date(Number(a), Number(b) - 1, Number(c));
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

function parseNumber(val: string): number | null {
  if (!val) return null;
  const cleaned = val.replace(/[,$\s]/g, "");
  const num = Number(cleaned);
  return isNaN(num) ? null : num;
}

const VALID_CLAUSE_TYPES = ["PRICING", "TIMELINE", "SCOPE", "QUALITY", "REGULATORY", "PAYMENT_TERMS", "IP", "OTHER"];
const VALID_TERM_TYPES = ["RESERVATION_FEE", "COMMITMENT_DATE", "PAYMENT_MILESTONE", "CANCELLATION_WINDOW", "PENALTY_RULE", "MATERIAL_ORDER_TRIGGER"];

export function validateRows(
  rows: Record<string, string>[],
  targetType: string,
  columnMap: Record<string, string>,
  existingInvoiceNumbers?: string[]
): ValidationResult {
  const fields = getTargetFields(targetType);
  const valid: ValidatedRow[] = [];
  const warnings: ValidatedRow[] = [];
  const errors: ValidatedRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowErrors: string[] = [];
    const rowWarnings: string[] = [];
    const mapped: Record<string, string | number | null> = {};

    for (const field of fields) {
      const sourceCol = columnMap[field.key];
      const rawVal = sourceCol ? (row[sourceCol] ?? "").trim() : "";

      if (field.required && !rawVal) {
        rowErrors.push(`${field.label} is required`);
        mapped[field.key] = null;
        continue;
      }

      if (field.key === "totalAmount" || field.key === "value") {
        const num = parseNumber(rawVal);
        if (rawVal && num === null) {
          rowErrors.push(`${field.label} must be a number`);
        } else if (rawVal && rawVal.includes(",")) {
          rowWarnings.push(`${field.label} had comma formatting removed`);
        }
        mapped[field.key] = num;
      } else if (field.key === "invoiceDate") {
        const date = parseDate(rawVal);
        if (rawVal && !date) {
          rowWarnings.push(`${field.label} could not be parsed`);
        }
        mapped[field.key] = date ? date.toISOString() : null;
      } else if (field.key === "type" && rawVal) {
        const upper = rawVal.toUpperCase().replace(/\s+/g, "_");
        if (!VALID_CLAUSE_TYPES.includes(upper)) {
          rowWarnings.push(`${field.label} "${rawVal}" not recognized, defaulting to OTHER`);
          mapped[field.key] = "OTHER";
        } else {
          mapped[field.key] = upper;
        }
      } else if (field.key === "termType" && rawVal) {
        const upper = rawVal.toUpperCase().replace(/\s+/g, "_");
        if (!VALID_TERM_TYPES.includes(upper)) {
          rowWarnings.push(`${field.label} "${rawVal}" not recognized`);
          mapped[field.key] = null;
        } else {
          mapped[field.key] = upper;
        }
      } else {
        mapped[field.key] = rawVal || null;
      }
    }

    if (targetType === "INVOICE" && mapped.invoiceNumber && existingInvoiceNumbers) {
      if (existingInvoiceNumbers.includes(String(mapped.invoiceNumber))) {
        rowErrors.push(`Invoice number "${mapped.invoiceNumber}" already exists`);
      }
    }

    const entry: ValidatedRow = {
      rowIndex: i,
      status: rowErrors.length > 0 ? "error" : rowWarnings.length > 0 ? "warning" : "valid",
      data: row,
      mapped,
      errors: rowErrors,
      warnings: rowWarnings,
    };

    if (rowErrors.length > 0) errors.push(entry);
    else if (rowWarnings.length > 0) warnings.push(entry);
    else valid.push(entry);
  }

  return { valid, warnings, errors, totalRows: rows.length };
}

export async function applyImport(
  rows: ValidatedRow[],
  targetType: string,
  programId: string,
  _orgId: string
): Promise<{ createdCount: number; createdIds: string[] }> {
  const createdIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const m = row.mapped;

      if (targetType === "INVOICE") {
        const invoice = await tx.invoice.create({
          data: {
            programId,
            invoiceNumber: m.invoiceNumber as string | null,
            totalAmount: m.totalAmount != null ? new Prisma.Decimal(m.totalAmount as number) : null,
            invoiceDate: m.invoiceDate ? new Date(m.invoiceDate as string) : null,
            vendorName: m.vendorName as string | null,
            currency: (m.currency as string) || "USD",
          },
        });
        createdIds.push(invoice.id);
      } else if (targetType === "BASELINE") {
        const baseline = await tx.baseline.findFirst({
          where: { programId, status: "DRAFT" },
          orderBy: { version: "desc" },
        });
        if (!baseline) throw new Error("No DRAFT baseline found for this program");

        const maxSort = await tx.baselineClause.aggregate({
          where: { baselineId: baseline.id },
          _max: { sortOrder: true },
        });

        const clause = await tx.baselineClause.create({
          data: {
            baselineId: baseline.id,
            title: m.title as string,
            type: (m.type as string as import("@/generated/prisma/client").ClauseType) ?? "OTHER",
            value: m.value != null ? new Prisma.Decimal(m.value as number) : null,
            unit: m.unit as string | null,
            description: m.description as string | null,
            sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
          },
        });
        createdIds.push(clause.id);
      } else if (targetType === "CONTRACT") {
        const maxSort = await tx.commitmentTerm.aggregate({
          where: { programId },
          _max: { sortOrder: true },
        });

        const term = await tx.commitmentTerm.create({
          data: {
            programId,
            label: m.label as string,
            termType: (m.termType as string as import("@/generated/prisma/client").TermType) ?? "COMMITMENT_DATE",
            dateOrOffset: m.dateOrOffset as string | null,
            costOrPercent: m.costOrPercent as string | null,
            conditions: m.conditions as string | null,
            sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
          },
        });
        createdIds.push(term.id);
      }
    }
  });

  return { createdCount: createdIds.length, createdIds };
}
