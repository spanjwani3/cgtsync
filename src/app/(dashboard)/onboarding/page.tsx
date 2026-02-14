"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Step = 1 | 2 | 3;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Step 1: Program info
  const [name, setName] = useState("");
  const [cdmoName, setCdmoName] = useState("");
  const [molecule, setMolecule] = useState("");
  const [modality, setModality] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [changeThreshold, setChangeThreshold] = useState("");

  // Step 2: File upload
  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<"INVOICE" | "SOW_MSA">("INVOICE");
  const [programId, setProgramId] = useState("");

  // Step 3: Results
  const [flags, setFlags] = useState<string[]>([]);
  const [exportGenerated, setExportGenerated] = useState(false);

  async function handleCreateProgram() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/programs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          cdmoName,
          molecule: molecule || undefined,
          modality: modality || undefined,
          currency,
          changeThreshold: changeThreshold ? parseFloat(changeThreshold) : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create program");
      }
      const program = await res.json();
      setProgramId(program.id);
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload() {
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", fileType);
      formData.append("programId", programId);

      const res = await fetch("/api/gateway/evidence", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }

      // If it's an invoice, create the invoice record
      if (fileType === "INVOICE") {
        const evidence = await res.json();
        const invoiceRes = await fetch("/api/invoices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            programId,
            invoiceNumber: file.name.replace(/\.[^.]+$/, ""),
            evidenceFileId: evidence.id,
          }),
        });
        if (invoiceRes.ok) {
          setFlags(["Invoice uploaded — add line items to begin reconciliation"]);
        }
      } else {
        setFlags(["SOW/MSA uploaded — create a Baseline to begin clause extraction"]);
      }
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateExport() {
    setLoading(true);
    setError("");
    try {
      const type =
        fileType === "INVOICE" ? "INVOICE_REVIEW_PACK" : "BASELINE_PACK";
      const res = await fetch("/api/gateway/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId, type }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Export failed");
      }
      setExportGenerated(true);

      // Mark program as activated
      await fetch(`/api/programs/${programId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ACTIVE" }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl py-8">
      <h1 className="text-2xl font-semibold text-zinc-900">
        Program Onboarding
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        Set up your Sponsor–CDMO program in 3 steps
      </p>

      {/* Step indicator */}
      <div className="mt-6 flex items-center gap-2">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                s === step
                  ? "bg-zinc-900 text-white"
                  : s < step
                    ? "bg-green-100 text-green-700"
                    : "bg-zinc-100 text-zinc-400"
              }`}
            >
              {s < step ? "✓" : s}
            </div>
            {s < 3 && (
              <div
                className={`h-px w-12 ${s < step ? "bg-green-300" : "bg-zinc-200"}`}
              />
            )}
          </div>
        ))}
        <span className="ml-3 text-sm text-zinc-500">
          {step === 1
            ? "Create Program"
            : step === 2
              ? "Upload Document"
              : "Review & Export"}
        </span>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Step 1: Create Program */}
      {step === 1 && (
        <div className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Program Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., CAR-T Manufacturing Q1 2026"
              className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              CDMO Name *
            </label>
            <input
              type="text"
              value={cdmoName}
              onChange={(e) => setCdmoName(e.target.value)}
              placeholder="e.g., Lonza, Samsung Biologics"
              className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700">
                Molecule
              </label>
              <input
                type="text"
                value={molecule}
                onChange={(e) => setMolecule(e.target.value)}
                placeholder="Optional"
                className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700">
                Modality
              </label>
              <input
                type="text"
                value={modality}
                onChange={(e) => setModality(e.target.value)}
                placeholder="e.g., mAb, ADC, Cell Therapy"
                className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700">
                Currency
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="CHF">CHF</option>
                <option value="JPY">JPY</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700">
                Auto-log Threshold
              </label>
              <input
                type="number"
                value={changeThreshold}
                onChange={(e) => setChangeThreshold(e.target.value)}
                placeholder="e.g., 50000"
                className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              />
              <p className="mt-1 text-xs text-zinc-400">
                Changes below this amount auto-log without confirmation
              </p>
            </div>
          </div>

          <button
            onClick={handleCreateProgram}
            disabled={!name || !cdmoName || loading}
            className="mt-4 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Program →"}
          </button>
        </div>
      )}

      {/* Step 2: Upload Document */}
      {step === 2 && (
        <div className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Document Type
            </label>
            <div className="mt-2 flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="fileType"
                  value="INVOICE"
                  checked={fileType === "INVOICE"}
                  onChange={() => setFileType("INVOICE")}
                  className="text-zinc-900"
                />
                Invoice
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="fileType"
                  value="SOW_MSA"
                  checked={fileType === "SOW_MSA"}
                  onChange={() => setFileType("SOW_MSA")}
                  className="text-zinc-900"
                />
                SOW / MSA
              </label>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">
              Upload File
            </label>
            <div className="mt-1 flex items-center justify-center rounded-md border-2 border-dashed border-zinc-300 px-6 py-8">
              <div className="text-center">
                <input
                  type="file"
                  accept=".pdf,.xlsx,.xls,.csv,.doc,.docx"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="text-sm text-zinc-500"
                />
                <p className="mt-1 text-xs text-zinc-400">
                  PDF, Excel, CSV, or Word documents
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleUpload}
              disabled={!file || loading}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Uploading..." : "Upload & Continue →"}
            </button>
            <button
              onClick={() => setStep(3)}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Skip for now
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Red Flags + Generate Export */}
      {step === 3 && (
        <div className="mt-6 space-y-4">
          {flags.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
              <h3 className="text-sm font-medium text-amber-800">
                Initial Assessment
              </h3>
              <ul className="mt-2 space-y-1">
                {flags.map((flag, i) => (
                  <li key={i} className="text-sm text-amber-700">
                    → {flag}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!exportGenerated ? (
            <div>
              <p className="text-sm text-zinc-600">
                Generate your first export pack to complete onboarding and
                activate the program.
              </p>
              <button
                onClick={handleGenerateExport}
                disabled={loading}
                className="mt-4 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Generating..." : "Generate First Export"}
              </button>
            </div>
          ) : (
            <div className="rounded-md border border-green-200 bg-green-50 p-4">
              <h3 className="text-sm font-medium text-green-800">
                Program Activated
              </h3>
              <p className="mt-1 text-sm text-green-700">
                Your first export has been generated. The program is now active.
              </p>
              <button
                onClick={() =>
                  router.push(`/programs/${programId}/cockpit`)
                }
                className="mt-3 rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-600"
              >
                Go to Program Cockpit →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
