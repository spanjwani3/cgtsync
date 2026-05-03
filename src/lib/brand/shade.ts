/**
 * Brand color helpers — pure, no deps. Used to derive hover / luminance
 * variants from a tenant-supplied accent hex.
 */

export const DEFAULT_ACCENT = "#2563eb";
export const DEFAULT_ACCENT_HOVER = "#1d4ed8";

export const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

export function isValidHex(value: string): boolean {
  return HEX_REGEX.test(value);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function parseHex(hex: string): [number, number, number] | null {
  if (!isValidHex(hex)) return null;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function toHex(n: number): string {
  return clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
}

/**
 * Lighten (positive) or darken (negative) a hex by `percent` (-100..100).
 * Returns the input unchanged if it isn't a valid hex.
 */
export function shade(hex: string, percent: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const factor = 1 + percent / 100;
  const [r, g, b] = rgb.map((c) => c * factor) as [number, number, number];
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Relative luminance per WCAG 2.x. */
export function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const sc = c / 255;
    return sc <= 0.03928 ? sc / 12.92 : Math.pow((sc + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two hex colors per WCAG 2.x. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
