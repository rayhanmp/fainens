/**
 * Parse an Indonesian Rupiah display value into the canonical integer-rupiah ledger unit.
 *
 * Accepted shapes (with an optional "Rp"/"IDR" prefix, sign or parentheses):
 * - plain digits: "100000"
 * - thousands groups using one separator consistently: "1.234.567", "1,234,567"
 * - an explicit two-digit zero fraction: "100,00", "1.234,00", "1,234.00"
 *
 * Anything ambiguous returns null instead of guessing. In particular a one-
 * or two-digit fraction other than "00" ("1.234,5", "10.5", "1.234,50") is
 * rejected because fractional rupiah cannot be represented, and a final group
 * that is neither a two-digit fraction nor a three-digit thousands group
 * ("1.2345") is rejected rather than glued onto the number.
 */
export function parseIdrInteger(value: string): number | null {
  let text = value.trim();
  if (!text) return null;
  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  text = text.replace(/^(?:rp\.?|idr)\s*/i, "").replace(/[\s ]/g, "");
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  }
  if (!/^[0-9]+(?:[.,][0-9]+)*$/.test(text)) return null;

  let integerPart = text;
  const finalSeparator = Math.max(text.lastIndexOf("."), text.lastIndexOf(","));
  if (finalSeparator >= 0) {
    const fraction = text.slice(finalSeparator + 1);
    if (fraction.length !== 3) {
      // A final group of 1-2 digits is a decimal part. Only an explicit zero
      // fraction can be represented in whole rupiah.
      if (fraction.length > 2 || !/^0+$/.test(fraction)) return null;
      const decimalSeparator = text[finalSeparator];
      integerPart = text.slice(0, finalSeparator);
      // The decimal separator cannot also be the thousands separator.
      if (integerPart.includes(decimalSeparator)) return null;
    }
  }

  if (/[.,]/.test(integerPart)) {
    const thousandsSeparator = integerPart.includes(".") ? "." : ",";
    if (integerPart.includes(thousandsSeparator === "." ? "," : ".")) return null;
    const groups = integerPart.split(thousandsSeparator);
    if (!/^[0-9]{1,3}$/.test(groups[0]) || groups.slice(1).some((group) => !/^[0-9]{3}$/.test(group))) return null;
  }
  const amount = Number(integerPart.replace(/[.,]/g, ""));
  if (!Number.isSafeInteger(amount)) return null;
  return negative ? -amount : amount;
}
