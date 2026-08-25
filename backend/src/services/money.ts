/** Parse an Indonesian Rupiah display value into the canonical integer-rupiah ledger unit. */
export function parseIdrInteger(value: string): number | null {
  let text = value.trim();
  if (!text) return null;
  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  text = text.replace(/^rp\s*/i, "").replace(/\s/g, "");
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  }
  if (!/^[0-9]+(?:[.,][0-9]+)*$/.test(text)) return null;

  const finalSeparator = Math.max(text.lastIndexOf("."), text.lastIndexOf(","));
  if (finalSeparator >= 0 && text.length - finalSeparator - 1 === 2) {
    const fraction = text.slice(finalSeparator + 1);
    // Fractional rupiah cannot be represented. Accept only explicit .00/,00.
    if (fraction !== "00") return null;
    text = text.slice(0, finalSeparator);
  }
  const digits = text.replace(/[.,]/g, "");
  const amount = Number(digits);
  if (!Number.isSafeInteger(amount)) return null;
  return negative ? -amount : amount;
}
