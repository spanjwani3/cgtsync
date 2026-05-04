export function formatCompact(amount: number, currency: string = "USD"): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  let value: string;
  if (abs >= 1_000_000) {
    value = `${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  } else if (abs >= 1_000) {
    value = `${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  } else {
    value = abs.toFixed(0);
  }
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${sign}${symbol}${value}`;
}
