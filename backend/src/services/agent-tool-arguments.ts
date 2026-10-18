/*
 * Tool-call arguments from smaller models are often almost-JSON: wrapped in a code fence, double-encoded as a string,
 * left with a trailing comma, or cut off before the closing brackets. Rejecting those used to fail the whole answer.
 * This repairs the common, unambiguous breakages and otherwise reports a message the model can act on.
 */

export type ParsedToolArguments =
  | { ok: true; value: Record<string, unknown>; repaired: boolean }
  | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Remove commas that sit directly before a closing bracket, ignoring anything inside strings. */
function stripTrailingCommas(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      out += char;
      continue;
    }
    if (char === ",") {
      let next = index + 1;
      while (next < text.length && /\s/.test(text[next])) next += 1;
      if (text[next] === "}" || text[next] === "]") continue;
    }
    out += char;
  }
  return out;
}

/** Close an unterminated string and any open objects or arrays, for output cut off mid-way. */
function closeOpenBrackets(text: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") stack.push("}");
    else if (char === "[") stack.push("]");
    else if (char === "}" || char === "]") stack.pop();
  }
  let closed = text;
  if (inString) closed += "\"";
  closed = closed.replace(/[,:]\s*$/, "");
  return closed + stack.reverse().join("");
}

export function parseToolArgumentsLeniently(raw: string | undefined | null): ParsedToolArguments {
  if (raw == null || raw.trim() === "") return { ok: true, value: {}, repaired: false };
  const direct = tryParse(raw);
  if (isRecord(direct)) return { ok: true, value: direct, repaired: false };
  // Double-encoded: the arguments are a JSON string that itself holds the object.
  if (typeof direct === "string") {
    const inner = tryParse(direct);
    if (isRecord(inner)) return { ok: true, value: inner, repaired: true };
  }
  if (direct !== undefined) return { ok: false, message: "Tool arguments must be a JSON object, not " + (Array.isArray(direct) ? "an array" : typeof direct) + "." };

  let text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  if (start < 0) return { ok: false, message: "Tool arguments were not JSON. Send a single JSON object." };
  const end = text.lastIndexOf("}");
  text = end > start ? text.slice(start, end + 1) : text.slice(start);
  for (const candidate of [stripTrailingCommas(text), stripTrailingCommas(closeOpenBrackets(text))]) {
    const parsed = tryParse(candidate);
    if (isRecord(parsed)) return { ok: true, value: parsed, repaired: true };
  }
  return { ok: false, message: "Tool arguments were invalid JSON and could not be repaired. Resend the call with one complete JSON object, double-quoted keys and no comments." };
}
