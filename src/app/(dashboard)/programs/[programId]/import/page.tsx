"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useParams } from "next/navigation";
import { useSyncProgram } from "@/components/layout/useSyncProgram";

type TargetType = "INVOICE" | "BASELINE" | "CONTRACT";

interface TargetField {
  key: string;
  label: string;
  required: boolean;
}

interface ValidatedRow {
  rowIndex: number;
  status: "valid" | "warning" | "error";
  data: Record<string, string>;
  mapped: Record<string, string | number | null>;
  errors: string[];
  warnings: string[];
}

interface SavedMapping {
  id: string;
  name: string;
  targetType: string;
  columnMap: Record<string, string>;
}

const TARGET_OPTIONS: { value: TargetType; label: string }[] = [
  { value: "INVOICE", label: "Invoices" },
  { value: "BASELINE", label: "Baseline Clauses" },
  { value: "CONTRACT", label: "Commitment Terms" },
];

export default function ImportPage() {
  const { programId } = useParams<{ programId: string }>();
  useSyncProgram();

  const [step, setStep] = useState(1);
  const [targetType, setTargetType] = useState<TargetType>("INVOICE");
  const [error, setError] = useState("");

  // Step 1: file upload
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [targetFields, setTargetFields] = useState<Record<string, TargetField[]>>({});

  // Step 2: column mapping
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [savedMappings, setSavedMappings] = useState<SavedMapping[]>([]);
  const [saveMappingName, setSaveMappingName] = useState("");
  const [savingMapping, setSavingMapping] = useState(false);

  // Step 3: validation
  const [validRows, setValidRows] = useState<ValidatedRow[]>([]);
  const [warningRows, setWarningRows] = useState<ValidatedRow[]>([]);
  const [errorRows, setErrorRows] = useState<ValidatedRow[]>([]);
  const [skipIndices, setSkipIndices] = useState<Set<number>>(new Set());

  // Step 4: execution
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{
    createdCount: number;
    skippedCount: number;
    errorCount: number;
  } | null>(null);

  const fields = targetFields[targetType] ?? [];

  const loadMappings = useCallback(async () => {
    try {
      const res = await fetch(`/api/gateway/import/mappings?targetType=${targetType}`);
      if (res.ok) {
        setSavedMappings(await res.json());
      }
    } catch {
      // silent
    }
  }, [targetType]);

  useEffect(() => {
    if (step === 2) {
      loadMappings();
    }
  }, [step, loadMappings]);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("programId", programId);

      const res = await fetch("/api/gateway/import/parse", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");

      setFileName(file.name);
      setHeaders(data.headers);
      setRows(data.rows);
      setPreviewRows(data.previewRows);
      setTotalRows(data.totalRows);
      setTargetFields(data.targetFields);

      const autoMap: Record<string, string> = {};
      const currentFields = data.targetFields[targetType] ?? [];
      for (const field of currentFields) {
        const match = data.headers.find(
          (h: string) => h.toLowerCase().replace(/[\s_-]/g, "") === field.key.toLowerCase().replace(/[\s_-]/g, "")
        );
        if (match) autoMap[field.key] = match;
      }
      setColumnMap(autoMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  function handleMapChange(fieldKey: string, headerValue: string) {
    setColumnMap((prev) => {
      const next = { ...prev };
      if (headerValue) {
        next[fieldKey] = headerValue;
      } else {
        delete next[fieldKey];
      }
      return next;
    });
  }

  function applySavedMapping(mapping: SavedMapping) {
    setColumnMap(mapping.columnMap);
  }

  async function handleSaveMapping() {
    if (!saveMappingName.trim()) return;
    setSavingMapping(true);
    try {
      const res = await fetch("/api/gateway/import/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: saveMappingName, targetType, columnMap }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to save mapping");
      }
      setSaveMappingName("");
      await loadMappings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save mapping");
    } finally {
      setSavingMapping(false);
    }
  }

  function runValidation() {
    const validated: ValidatedRow[] = [];
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
        mapped[field.key] = rawVal || null;
      }

      validated.push({
        rowIndex: i,
        status: rowErrors.length > 0 ? "error" : rowWarnings.length > 0 ? "warning" : "valid",
        data: row,
        mapped,
        errors: rowErrors,
        warnings: rowWarnings,
      });
    }

    setValidRows(validated.filter((r) => r.status === "valid"));
    setWarningRows(validated.filter((r) => r.status === "warning"));
    setErrorRows(validated.filter((r) => r.status === "error"));
    setSkipIndices(new Set());
    setStep(3);
  }

  function toggleSkip(rowIndex: number) {
    setSkipIndices((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) {
        next.delete(rowIndex);
      } else {
        next.add(rowIndex);
      }
      return next;
    });
  }

  async function handleExecute() {
    setExecuting(true);
    setError("");
    try {
      const res = await fetch("/api/gateway/import/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programId,
          targetType,
          columnMap,
          rows,
          skipIndices: Array.from(skipIndices),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");

      setResult(data);
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setExecuting(false);
    }
  }

  function handleReset() {
    setStep(1);
    setFileName("");
    setHeaders([]);
    setRows([]);
    setPreviewRows([]);
    setTotalRows(0);
    setColumnMap({});
    setValidRows([]);
    setWarningRows([]);
    setErrorRows([]);
    setSkipIndices(new Set());
    setResult(null);
    setError("");
  }

  const requiredFieldsMapped = fields.filter((f) => f.required).every((f) => columnMap[f.key]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Import Data</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Import invoices, baseline clauses, or commitment terms from CSV or Excel files
          </p>
        </div>
        {step > 1 && step < 4 && (
          <button onClick={handleReset} className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
            Start Over
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Step indicator */}
      <div className="mt-6 flex items-center gap-2">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                s === step
                  ? "bg-zinc-900 text-white"
                  : s < step
                  ? "bg-green-100 text-green-700"
                  : "bg-zinc-100 text-zinc-400"
              }`}
            >
              {s < step ? "\u2713" : s}
            </div>
            <span className={`text-xs ${s === step ? "font-medium text-zinc-900" : "text-zinc-400"}`}>
              {s === 1 ? "Upload" : s === 2 ? "Map Columns" : s === 3 ? "Validate" : "Complete"}
            </span>
            {s < 4 && <div className="mx-2 h-px w-8 bg-zinc-200" />}
          </div>
        ))}
      </div>

      {/* Step 1: Upload + Target Type */}
      {step === 1 && (
        <div className="mt-6 space-y-6">
          <div className="rounded-lg border border-zinc-200 bg-white p-6">
            <h2 className="text-sm font-semibold text-zinc-900">Target Type</h2>
            <p className="mt-1 text-xs text-zinc-500">What kind of data are you importing?</p>
            <div className="mt-3 flex gap-3">
              {TARGET_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTargetType(opt.value)}
                  className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                    targetType === opt.value
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-300 text-zinc-700 hover:bg-zinc-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-6">
            <h2 className="text-sm font-semibold text-zinc-900">Upload File</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Supported formats: CSV (.csv), Excel (.xlsx, .xls). Maximum 5,000 rows.
            </p>
            <div className="mt-4">
              {fileName ? (
                <div className="flex items-center gap-3 rounded-md border border-green-200 bg-green-50 p-3">
                  <span className="text-sm font-medium text-green-700">{fileName}</span>
                  <span className="text-xs text-green-600">{totalRows} rows, {headers.length} columns</span>
                </div>
              ) : (
                <label className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 p-8 transition-colors hover:border-zinc-400 ${uploading ? "opacity-50" : ""}`}>
                  <svg className="h-8 w-8 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span className="mt-2 text-sm text-zinc-600">
                    {uploading ? "Parsing file..." : "Click to select a CSV or Excel file"}
                  </span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    className="hidden"
                    onChange={handleFileUpload}
                    disabled={uploading}
                  />
                </label>
              )}
            </div>
          </div>

          {fileName && previewRows.length > 0 && (
            <div className="rounded-lg border border-zinc-200 bg-white p-6">
              <h2 className="text-sm font-semibold text-zinc-900">Preview (first 10 rows)</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      {headers.map((h) => (
                        <th key={h} className="whitespace-nowrap border-b border-zinc-200 px-3 py-2 text-left font-medium text-zinc-500">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-b border-zinc-100">
                        {headers.map((h) => (
                          <td key={h} className="whitespace-nowrap px-3 py-1.5 text-zinc-700">
                            {row[h] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {fileName && (
            <div className="flex justify-end">
              <button
                onClick={() => setStep(2)}
                className="rounded-md bg-zinc-900 px-6 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Next: Map Columns
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Column Mapping */}
      {step === 2 && (
        <div className="mt-6 space-y-6">
          {savedMappings.length > 0 && (
            <div className="rounded-lg border border-zinc-200 bg-white p-6">
              <h2 className="text-sm font-semibold text-zinc-900">Saved Mappings</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {savedMappings.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => applySavedMapping(m)}
                    className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-zinc-200 bg-white p-6">
            <h2 className="text-sm font-semibold text-zinc-900">Column Mapping</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Map your file columns to the target fields. Required fields are marked with *.
            </p>
            <div className="mt-4 space-y-3">
              {fields.map((field) => (
                <div key={field.key} className="flex items-center gap-4">
                  <label className="w-48 text-sm text-zinc-700">
                    {field.label}
                    {field.required && <span className="ml-1 text-red-500">*</span>}
                  </label>
                  <select
                    value={columnMap[field.key] ?? ""}
                    onChange={(e) => handleMapChange(field.key, e.target.value)}
                    className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm"
                  >
                    <option value="">-- Select column --</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-6">
            <h2 className="text-sm font-semibold text-zinc-900">Save This Mapping</h2>
            <div className="mt-3 flex items-center gap-3">
              <input
                type="text"
                value={saveMappingName}
                onChange={(e) => setSaveMappingName(e.target.value)}
                placeholder="Mapping name (e.g. Vendor A Invoices)"
                className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm"
              />
              <button
                onClick={handleSaveMapping}
                disabled={!saveMappingName.trim() || savingMapping}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              >
                {savingMapping ? "Saving..." : "Save"}
              </button>
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep(1)}
              className="rounded-md border border-zinc-300 px-6 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Back
            </button>
            <button
              onClick={runValidation}
              disabled={!requiredFieldsMapped}
              className="rounded-md bg-zinc-900 px-6 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              Next: Validate
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Validation Preview */}
      {step === 3 && (
        <div className="mt-6 space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <p className="text-2xl font-bold text-green-700">{validRows.length}</p>
              <p className="text-xs text-green-600">Valid rows</p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-2xl font-bold text-amber-700">{warningRows.length}</p>
              <p className="text-xs text-amber-600">Rows with warnings</p>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-2xl font-bold text-red-700">{errorRows.length}</p>
              <p className="text-xs text-red-600">Rows with errors</p>
            </div>
          </div>

          {errorRows.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-white p-6">
              <h2 className="text-sm font-semibold text-red-700">Errors ({errorRows.length})</h2>
              <p className="mt-1 text-xs text-zinc-500">These rows will not be imported.</p>
              <div className="mt-3 max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="border-b border-zinc-200 px-3 py-2 text-left font-medium text-zinc-500">Row</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-left font-medium text-zinc-500">Issues</th>
                      {fields.map((f) => (
                        <th key={f.key} className="border-b border-zinc-200 px-3 py-2 text-left font-medium text-zinc-500">{f.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {errorRows.map((row) => (
                      <tr key={row.rowIndex} className="border-b border-red-100 bg-red-50/50">
                        <td className="px-3 py-1.5 text-zinc-600">{row.rowIndex + 1}</td>
                        <td className="px-3 py-1.5 text-red-600">{row.errors.join("; ")}</td>
                        {fields.map((f) => (
                          <td key={f.key} className="px-3 py-1.5 text-zinc-700">
                            {columnMap[f.key] ? row.data[columnMap[f.key]] ?? "" : ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {warningRows.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-white p-6">
              <h2 className="text-sm font-semibold text-amber-700">Warnings ({warningRows.length})</h2>
              <p className="mt-1 text-xs text-zinc-500">These rows will be imported but may have data quality issues. You can skip individual rows.</p>
              <div className="mt-3 max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="border-b border-zinc-200 px-3 py-2 text-left font-medium text-zinc-500">Skip</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-left font-medium text-zinc-500">Row</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-left font-medium text-zinc-500">Warnings</th>
                      {fields.map((f) => (
                        <th key={f.key} className="border-b border-zinc-200 px-3 py-2 text-left font-medium text-zinc-500">{f.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {warningRows.map((row) => (
                      <tr key={row.rowIndex} className={`border-b border-amber-100 ${skipIndices.has(row.rowIndex) ? "opacity-40" : "bg-amber-50/50"}`}>
                        <td className="px-3 py-1.5">
                          <input
                            type="checkbox"
                            checked={skipIndices.has(row.rowIndex)}
                            onChange={() => toggleSkip(row.rowIndex)}
                            className="rounded border-zinc-300"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-zinc-600">{row.rowIndex + 1}</td>
                        <td className="px-3 py-1.5 text-amber-600">{row.warnings.join("; ")}</td>
                        {fields.map((f) => (
                          <td key={f.key} className="px-3 py-1.5 text-zinc-700">
                            {columnMap[f.key] ? row.data[columnMap[f.key]] ?? "" : ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {validRows.length > 0 && (
            <div className="rounded-lg border border-green-200 bg-white p-6">
              <h2 className="text-sm font-semibold text-green-700">Valid Rows ({validRows.length})</h2>
              <div className="mt-3 max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="border-b border-zinc-200 px-3 py-2 text-left font-medium text-zinc-500">Skip</th>
                      <th className="border-b border-zinc-200 px-3 py-2 text-left font-medium text-zinc-500">Row</th>
                      {fields.map((f) => (
                        <th key={f.key} className="border-b border-zinc-200 px-3 py-2 text-left font-medium text-zinc-500">{f.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {validRows.map((row) => (
                      <tr key={row.rowIndex} className={`border-b border-green-100 ${skipIndices.has(row.rowIndex) ? "opacity-40" : ""}`}>
                        <td className="px-3 py-1.5">
                          <input
                            type="checkbox"
                            checked={skipIndices.has(row.rowIndex)}
                            onChange={() => toggleSkip(row.rowIndex)}
                            className="rounded border-zinc-300"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-zinc-600">{row.rowIndex + 1}</td>
                        {fields.map((f) => (
                          <td key={f.key} className="px-3 py-1.5 text-zinc-700">
                            {columnMap[f.key] ? row.data[columnMap[f.key]] ?? "" : ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-between">
            <button
              onClick={() => setStep(2)}
              className="rounded-md border border-zinc-300 px-6 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Back
            </button>
            <button
              onClick={handleExecute}
              disabled={executing || (validRows.length + warningRows.length - skipIndices.size) === 0}
              className="rounded-md bg-zinc-900 px-6 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {executing ? "Importing..." : `Import ${validRows.length + warningRows.length - skipIndices.size} Rows`}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Results */}
      {step === 4 && result && (
        <div className="mt-6 space-y-6">
          <div className="rounded-lg border border-green-200 bg-green-50 p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <svg className="h-6 w-6 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 className="mt-4 text-lg font-semibold text-green-800">Import Complete</h2>
            <p className="mt-2 text-sm text-green-700">
              Successfully created {result.createdCount} {targetType === "INVOICE" ? "invoice" : targetType === "BASELINE" ? "baseline clause" : "commitment term"}{result.createdCount !== 1 ? "s" : ""}.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg border border-zinc-200 bg-white p-4 text-center">
              <p className="text-2xl font-bold text-green-700">{result.createdCount}</p>
              <p className="text-xs text-zinc-500">Created</p>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-4 text-center">
              <p className="text-2xl font-bold text-zinc-500">{result.skippedCount}</p>
              <p className="text-xs text-zinc-500">Skipped</p>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-4 text-center">
              <p className="text-2xl font-bold text-red-600">{result.errorCount}</p>
              <p className="text-xs text-zinc-500">Errors</p>
            </div>
          </div>

          <div className="flex justify-center">
            <button
              onClick={handleReset}
              className="rounded-md bg-zinc-900 px-6 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Import Another File
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
