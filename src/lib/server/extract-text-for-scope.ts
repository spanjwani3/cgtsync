/**
 * Extract raw prose from an inbound-email attachment so it can feed
 * `analyzeScopeFromText`. Distinct from `runExtraction`, which returns
 * structured data per a Zod schema — here we just want the text body.
 *
 * Supported mime types:
 *   text/*           → UTF-8 decode of the storage object
 *   application/pdf  → single Claude doc-block call ("transcribe verbatim")
 *
 * Anything else throws `UNSUPPORTED_MIME:<mimeType>` so callers can log a
 * recoverable failure and skip the attachment without aborting the rest of
 * the inbound pipeline.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getSignedUrl } from "@/lib/server/storage";

const PDF_TRANSCRIBE_MODEL = "claude-sonnet-4-5-20250929";
const PDF_TRANSCRIBE_PROMPT =
  "Extract all text content from this PDF verbatim. Preserve paragraph " +
  "breaks. Do not summarize, paraphrase, or add commentary. Return only " +
  "the document text.";

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  return new Anthropic({ apiKey, maxRetries: 4 });
}

async function downloadBuffer(storagePath: string): Promise<Buffer> {
  const signedUrl = await getSignedUrl(storagePath, 120);
  const res = await fetch(signedUrl);
  if (!res.ok) {
    throw new Error(`Failed to download attachment: ${res.statusText}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export function isScopeEligibleMime(mimeType: string): boolean {
  if (!mimeType) return false;
  if (mimeType.startsWith("text/")) return true;
  if (mimeType === "application/pdf") return true;
  return false;
}

export async function extractTextForScope(
  storagePath: string,
  mimeType: string,
): Promise<string> {
  const buffer = await downloadBuffer(storagePath);

  if (mimeType.startsWith("text/")) {
    return buffer.toString("utf-8");
  }

  if (mimeType === "application/pdf") {
    const client = getClient();
    const response = await client.messages.create({
      model: PDF_TRANSCRIBE_MODEL,
      max_tokens: 16384,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: buffer.toString("base64"),
              },
            },
            { type: "text", text: PDF_TRANSCRIBE_PROMPT },
          ],
        },
      ],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("PDF transcription returned no text block");
    }
    return textBlock.text;
  }

  throw new Error(`UNSUPPORTED_MIME:${mimeType}`);
}
