import { and, desc, eq, inArray, lt } from "drizzle-orm";

import { db as defaultDb } from "../db/client";
import { goalNotePages, goalNoteVersions, savingsGoals } from "../db/schema";

/**
 * A goal's notes are pages of markdown. Besides plain markdown they hold a few marks of their own:
 * `[[part:12|Flights]]` links a part, booking or file of the goal, and `@[2027-03-14]` is a date
 * (on a checklist item, its due date).
 */

/** At most one saved copy per page this often, and this many kept. */
export const VERSION_EVERY_MS = 10 * 60_000;
export const VERSIONS_KEPT = 50;

/** A line of notes as plain words: links become their names and dates read as dates. */
export function plainLine(line: string): string {
  return line
    .replace(/\[\[[a-z]+:\d+\|([^\]]*)\]\]/g, "$1")
    .replace(/@\[(\d{4}-\d{2}-\d{2})\]/g, (_match, date: string) => new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }))
    .replace(/\*\*|__|==|~~/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

export type DueTask = { text: string; dueAt: number };

/** Unticked checklist items that carry a date: the date is when they're due. */
export function dueTasks(markdown: string): DueTask[] {
  const tasks: DueTask[] = [];
  for (const line of markdown.split("\n")) {
    const item = /^\s*[-*+]\s+\[ \]\s+(.*)$/.exec(line);
    if (!item) continue;
    // A date is kept as a tag by the editor (<span data-date="2027-03-14">14 Mar 2027</span>), or typed as @[2027-03-14].
    const date = /<span data-date="(\d{4})-(\d{2})-(\d{2})">[^<]*<\/span>|@\[(\d{4})-(\d{2})-(\d{2})\]/.exec(item[1]!);
    if (!date) continue;
    const [year, month, day] = date[1] ? [date[1], date[2], date[3]] : [date[4], date[5], date[6]];
    const dueAt = new Date(Number(year), Number(month) - 1, Number(day), 12).getTime();
    tasks.push({ text: plainLine(item[1]!.replace(date[0], "")).replace(/\s+/g, " ").trim() || "A task", dueAt });
  }
  return tasks;
}

/** Every active goal's unticked, dated checklist items, soonest first. */
export async function goalDueTasks(dbLike: any = defaultDb) {
  const rows = await dbLike
    .select({ goalId: goalNotePages.goalId, pageId: goalNotePages.id, content: goalNotePages.content, goalName: savingsGoals.name })
    .from(goalNotePages)
    .innerJoin(savingsGoals, eq(goalNotePages.goalId, savingsGoals.id))
    .where(eq(savingsGoals.status, "active"));
  return (rows as Array<{ goalId: number; pageId: number; content: string; goalName: string }>)
    .flatMap((row) => dueTasks(row.content).map((task) => ({ goalId: row.goalId, goalName: row.goalName, pageId: row.pageId, ...task })))
    .sort((a, b) => a.dueAt - b.dueAt);
}

/**
 * Saves a page's new content, keeping its old content as a copy first when the last copy is older
 * than ten minutes (or there is none); only the newest fifty copies are kept.
 */
export async function savePageContent(page: typeof goalNotePages.$inferSelect, content: string, dbLike: any = defaultDb, force = false) {
  if (page.content === content) return;
  if (page.content.trim()) {
    const [latest] = await dbLike.select({ createdAt: goalNoteVersions.createdAt }).from(goalNoteVersions)
      .where(eq(goalNoteVersions.pageId, page.id)).orderBy(desc(goalNoteVersions.createdAt), desc(goalNoteVersions.id)).limit(1);
    if (force || !latest || Date.now() - latest.createdAt.getTime() >= VERSION_EVERY_MS) {
      await dbLike.insert(goalNoteVersions).values({ pageId: page.id, content: page.content, createdAt: new Date() });
      const kept = await dbLike.select({ id: goalNoteVersions.id }).from(goalNoteVersions)
        .where(eq(goalNoteVersions.pageId, page.id)).orderBy(desc(goalNoteVersions.createdAt), desc(goalNoteVersions.id)).limit(VERSIONS_KEPT);
      const oldest = kept.at(-1);
      if (kept.length === VERSIONS_KEPT && oldest) {
        await dbLike.delete(goalNoteVersions).where(and(eq(goalNoteVersions.pageId, page.id), lt(goalNoteVersions.id, oldest.id)));
      }
    }
  }
  await dbLike.update(goalNotePages).set({ content, updatedAt: new Date() }).where(eq(goalNotePages.id, page.id));
}

/** Note pages whose title or text holds the words, across every goal, with a snippet around the first hit. */
export async function searchNotes(query: string, dbLike: any = defaultDb) {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const rows = await dbLike
    .select({ pageId: goalNotePages.id, pageTitle: goalNotePages.title, content: goalNotePages.content, goalId: savingsGoals.id, goalName: savingsGoals.name, goalIcon: savingsGoals.icon })
    .from(goalNotePages)
    .innerJoin(savingsGoals, eq(goalNotePages.goalId, savingsGoals.id))
    .where(inArray(savingsGoals.status, ["active", "done"]));
  const hits: Array<{ goalId: number; goalName: string; goalIcon: string | null; pageId: number; pageTitle: string; snippet: string }> = [];
  for (const row of rows as Array<{ pageId: number; pageTitle: string; content: string; goalId: number; goalName: string; goalIcon: string | null }>) {
    const text = row.content.split("\n").map(plainLine).filter(Boolean).join(" · ");
    const at = text.toLowerCase().indexOf(needle);
    if (at < 0 && !row.pageTitle.toLowerCase().includes(needle)) continue;
    const start = Math.max(0, at - 40);
    const snippet = at < 0 ? text.slice(0, 120) : `${start > 0 ? "…" : ""}${text.slice(start, at + needle.length + 80)}${at + needle.length + 80 < text.length ? "…" : ""}`;
    hits.push({ goalId: row.goalId, goalName: row.goalName, goalIcon: row.goalIcon ?? null, pageId: row.pageId, pageTitle: row.pageTitle, snippet });
    if (hits.length >= 30) break;
  }
  return hits;
}
