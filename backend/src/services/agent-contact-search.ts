import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { contacts } from "../db/schema";
import { getFinancialRevision } from "./financial-revision";

export const findContactsInputJsonSchema = {
  type: "object", additionalProperties: false, required: ["query", "selection"], properties: {
    query: { type: "string", minLength: 1, maxLength: 120 }, includeInactive: { type: "boolean" },
    selection: { oneOf: [
      { type: "object", additionalProperties: false, required: ["mode"], properties: { mode: { type: "string", enum: ["all"] } } },
      { type: "object", additionalProperties: false, required: ["mode", "limit"], properties: { mode: { type: "string", enum: ["page"] }, limit: { type: "integer", minimum: 1, maximum: 100 }, offset: { type: "integer", minimum: 0 } } },
    ] },
  },
} as const;

export const contactSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(120),
  includeInactive: z.boolean().default(false),
  selection: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("all") }).strict(),
    z.object({ mode: z.literal("page"), limit: z.number().int().min(1).max(100), offset: z.number().int().nonnegative().default(0) }).strict(),
  ]),
}).strict();

type ContactNameRow = { id: number; name: string; fullName: string | null; kind: string; isActive: boolean };

export function normalizeContactName(name: string): string {
  return name.normalize("NFKD").replace(/\p{M}/gu, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

/** Return identities only, not private contact details or unrelated ledger data. */
export function matchContactNames(rows: ContactNameRow[], query: string) {
  const needle = normalizeContactName(query);
  if (!needle) return [];
  return rows.flatMap((row) => {
    const fields = (["name", "fullName"] as const).filter((field) => row[field] && normalizeContactName(row[field]!).includes(needle));
    if (fields.length === 0) return [];
    const exactField = fields.find((field) => normalizeContactName(row[field]!) === needle);
    return [{ ...row, matchType: exactField ? "exact" as const : "partial" as const, matchedField: exactField ?? fields[0] }];
  }).sort((a, b) => Number(b.matchType === "exact") - Number(a.matchType === "exact")
    || a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.id - b.id);
}

export async function findContactsTool(value: unknown) {
  const input = contactSearchInputSchema.parse(value);
  const rows = await db.select({ id: contacts.id, name: contacts.name, fullName: contacts.fullName, kind: contacts.kind, isActive: contacts.isActive })
    .from(contacts).where(input.includeInactive ? undefined : eq(contacts.isActive, true));
  const matches = matchContactNames(rows, input.query);
  const exactMatchCount = matches.filter((row) => row.matchType === "exact").length;
  if (input.selection.mode === "all" && matches.length > 100) throw new Error("More than 100 matching contacts; narrow the name or request selection.mode=page with a limit and offset");
  const offset = input.selection.mode === "page" ? input.selection.offset : 0;
  const selected = input.selection.mode === "page" ? matches.slice(offset, offset + input.selection.limit) : matches;
  const nextOffset = offset + selected.length < matches.length ? offset + selected.length : null;
  return {
    data: { query: input.query, contacts: selected, availableCount: matches.length, exactMatchCount,
      ambiguous: exactMatchCount > 1 || (exactMatchCount === 0 && matches.length > 1),
      selectionApplied: input.selection, complete: input.selection.mode === "all" || (offset === 0 && nextOffset === null), nextOffset },
    revision: await getFinancialRevision(), readOnly: true,
  };
}
