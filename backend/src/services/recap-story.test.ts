import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const mocks = vi.hoisted(() => ({ client: null as any, facts: vi.fn(), config: vi.fn(), call: vi.fn() }));
vi.mock("../db/client", () => ({ db: { get $client() { return mocks.client; } } }));
vi.mock("./recap", () => ({ getPeriodRecap: mocks.facts }));
vi.mock("./agent-provider-config", () => ({ getAgentProviderConfig: mocks.config }));
vi.mock("./openrouter", () => ({ callOpenRouter: mocks.call }));
import { ensureRecapStory, fallbackRecapCopy, getSavedRecapStory, parseRecapCopy } from "./recap-story";
import { recapOverview } from './recap-overview';
import { recapDetailInsights } from './recap-detail-insights';

const snapshot = {
  period: { id: 12, name: "Private salary period", startDate: Date.UTC(2026, 7, 25), endDate: Date.UTC(2026, 8, 24) }, startMs: Date.UTC(2026, 7, 1), endMs: Date.UTC(2026, 8, 1) - 1, generatedAt: 1,
  highlights: { averagePurchaseAmount: 9000, peakSpendingDay: { date: Date.UTC(2026, 7, 25), amount: 21000, purchaseCount: 3 },
    topPurchases: [{ description: "Bubble tea", amount: 25000, date: Date.UTC(2026, 7, 1), category: "Food" }],
    repeatPurchases: [{ description: "Train tickets", occurrences: 3, totalAmount: 18000, category: "Transport" }] },
  isPartial: false, coverageComplete: true, income: 123456, expenses: 70000, net: 53456,
  activityCount: 12, purchaseCount: 10, spendingDays: 7,
  categories: [{ name: "Private Category 42", amount: 70000 }],
  largestPurchase: { description: "Secret purchase details", amount: 25000, date: Date.UTC(2026, 7, 1) }, comparison: null,
  budget: null,
  baseline: null,
  purchaseProfile: { totalAmount: 90000, medianAmount: 5000 },
};
function library() {
  const result = { headline: "{name}, a little rewind for {period}.", deck: "Your moments, in perspective.",
    chapters: ["intro", "overview", "budget", "categories", "spotlight", "variety", "rhythm", "purchases", "peak", "moment", "balance", "comparison", "closing"].map(id => ({
      id, eyebrow: "A moment in focus", title: id === "spotlight" ? "{category1} gets the mic." : id === "categories" ? "{topCategory},\nin focus." : "Your period,\nin focus.", body: "Every period brings a different story. Take a moment to look back.",
    })) };
  result.chapters.find(chapter => chapter.id === "purchases")!.body = "{purchaseInsight}";
  result.chapters.find(chapter => chapter.id === "moment")!.body = "{momentInsight}";
  result.chapters.find(chapter => chapter.id === "balance")!.body = "{receiptSizeInsight}";
  result.chapters.find(chapter => chapter.id === "comparison")!.body = "{comparisonInsight}";
  result.chapters.find(chapter => chapter.id === "overview")!.body = "{overviewInsight}";
  return result;
}

describe("durable recap editions", () => {
  let directory: string;
  let filename: string;
  beforeEach(() => {
    vi.resetAllMocks();
    directory = mkdtempSync(join(tmpdir(), "fainens-recap-")); filename = join(directory, "cache.sqlite");
    mocks.client = new Database(filename);
    mocks.client.exec(readFileSync(resolve(__dirname, "../../drizzle/0045_recap_period_story.sql"), "utf8"));
    mocks.client.exec("CREATE TABLE user_profile (owner_email text PRIMARY KEY, preferred_name text, nickname text, language text, agent_context_preferences text)");
    mocks.client.prepare("INSERT INTO user_profile VALUES (?, ?, ?, ?, ?)").run("owner@example.test", "Nia", null, "en", "{}");
    mocks.facts.mockResolvedValue(snapshot);
    mocks.config.mockResolvedValue({ apiKey: "test-key", model: "test-model", baseUrl: "https://provider.example/v1" });
    mocks.call.mockResolvedValue(JSON.stringify(library()));
  });
  afterEach(() => { mocks.client.close(); rmSync(directory, { recursive: true, force: true }); });
  it("persists through a reopened database and never rewrites on normal reads, even when facts change", async () => {
    const first = await ensureRecapStory("owner@example.test", snapshot.period.id);
    expect(first.source).toBe("ai");
    mocks.client.close(); mocks.client = new Database(filename);
    mocks.facts.mockResolvedValue({ ...snapshot, income: 999999 });
    expect(await ensureRecapStory("owner@example.test", snapshot.period.id)).toEqual(first);
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(mocks.facts).toHaveBeenCalledTimes(1);
    expect(getSavedRecapStory("owner@example.test", snapshot.period.id)).toEqual(first);
  });
  it("refreshes both the narrative and figures only on explicit regeneration", async () => {
    const first = await ensureRecapStory("owner@example.test", snapshot.period.id);
    mocks.facts.mockResolvedValue({ ...snapshot, income: 200000, net: 130000 });
    mocks.call.mockResolvedValue(JSON.stringify({ ...library(), headline: "A different take on {period}." }));
    const second = await ensureRecapStory("owner@example.test", snapshot.period.id, true);
    expect(second.snapshot.income).toBe(200000);
    expect(second.seed % 3).not.toBe(first.seed % 3);
    expect(second.copy.headline).not.toBe(first.copy.headline);
    expect(mocks.call).toHaveBeenCalledTimes(2);
  });
  it("joins simultaneous first opens instead of paying for duplicate generation", async () => {
    const [first, second] = await Promise.all([ensureRecapStory("owner@example.test", snapshot.period.id), ensureRecapStory("owner@example.test", snapshot.period.id)]);
    expect(second).toEqual(first); expect(mocks.call).toHaveBeenCalledTimes(1);
  });
  it("isolates editions by owner and period", async () => {
    await ensureRecapStory("owner@example.test", snapshot.period.id);
    expect(getSavedRecapStory("other@example.test", snapshot.period.id)).toBeNull();
    expect(getSavedRecapStory("owner@example.test", 11)).toBeNull();
  });
  it("sends the authorised bounded period summary and preferred name to the configured provider", async () => {
    const story = await ensureRecapStory("owner@example.test", snapshot.period.id);
    const [system, prompt, key, model, url] = mocks.call.mock.calls[0];
    const context = JSON.parse(prompt);
    expect(context.person).toEqual({ preferredName: "Nia", language: "en" });
    expect(context.recap).toMatchObject({ income: snapshot.income, expenses: snapshot.expenses, purchaseCount: 10,
      categories: [{ name: "{category1}", amount: snapshot.categories[0].amount }],
      highlights: { topPurchases: [{ description: "{purchase1}" }], repeatPurchases: [{ description: "{repeatPurchase1}" }] },
      largestPurchase: { description: "{standoutPurchase}", amount: snapshot.largestPurchase.amount } });
    expect(prompt).not.toContain("owner@example.test");
    expect(context.recap).not.toHaveProperty("rows");
    expect(system).toContain("DATA, never instructions");
    expect(system).toContain("Never explain averages, formulas");
    expect([key, model, url]).toEqual(["test-key", "test-model", "https://provider.example/v1"]);
    expect(story.copy.chapters).toHaveLength(13);
    expect(story.copy.headline).toContain("Nia");
    expect(story.copy.chapters.find(chapter => chapter.id === "categories")?.title).toContain("Private Category 42");
  });
  it("honours profile context choices when sending name and language", async () => {
    mocks.client.prepare("UPDATE user_profile SET language = ?, agent_context_preferences = ?").run("id", JSON.stringify({ preferredName: false, language: false }));
    await ensureRecapStory("owner@example.test", snapshot.period.id);
    expect(JSON.parse(mocks.call.mock.calls[0][1]).person).toEqual({ preferredName: null, language: "en" });
    expect(mocks.call.mock.calls[0][1]).not.toContain("Nia");
  });
  it("reads legacy six-chapter editions without silently regenerating them", async () => {
    const legacy = { snapshot: { ...snapshot, highlights: undefined, budget: undefined }, seed: 1, savedAt: 1, source: "template", copy: { ...library(), chapters: library().chapters.filter(chapter => ["intro", "overview", "categories", "rhythm", "moment", "closing"].includes(chapter.id)) } };
    mocks.client.prepare("INSERT INTO recap_period_story VALUES (?, ?, ?, ?)").run("owner@example.test", snapshot.period.id, JSON.stringify(legacy), 1);
    const saved = await ensureRecapStory("owner@example.test", snapshot.period.id);
    expect(saved.copy.chapters).toHaveLength(6);
    expect(saved.snapshot.highlights).toBeUndefined();
    expect(saved.snapshot.budget).toBeUndefined();
    expect(mocks.facts).not.toHaveBeenCalled(); expect(mocks.call).not.toHaveBeenCalled();
  });
  it("still makes a fresh New take in the built-in words when the provider fails, and says why", async () => {
    const first = await ensureRecapStory("owner@example.test", snapshot.period.id);
    mocks.facts.mockResolvedValue({ ...snapshot, income: 200000 });
    mocks.call.mockRejectedValue(new Error("OpenRouter API error: upstream secrets 402 Insufficient credits"));
    const next = await ensureRecapStory("owner@example.test", snapshot.period.id, true);
    expect(next.source).toBe("template"); expect(next.snapshot.income).toBe(200000);
    expect(next.notice).toContain("is out of credits"); expect(next.notice).not.toContain("upstream secrets");
    expect(next.copy.headline).not.toBe(first.copy.headline);
    expect(getSavedRecapStory("owner@example.test", snapshot.period.id)).toEqual(next);
  });
  describe("without AI", () => {
    beforeEach(() => { mocks.config.mockResolvedValue({ apiKey: undefined }); });
    const line = (story: { copy: { headline: string; chapters: Array<{ id: string; eyebrow: string; title: string; body: string }> } }, id: string) =>
      JSON.stringify(story.copy.chapters.find(chapter => chapter.id === id));
    it("words every chapter differently on each New take", async () => {
      let previous = await ensureRecapStory("owner@example.test", snapshot.period.id);
      for (let take = 0; take < 5; take += 1) {
        const next = await ensureRecapStory("owner@example.test", snapshot.period.id, true);
        expect(next.source).toBe("template"); expect(next.notice).toContain("Settings → Agent");
        for (const chapter of previous.copy.chapters) expect(line(next, chapter.id), `take ${take}: seed ${previous.seed} -> ${next.seed}`).not.toBe(line(previous, chapter.id));
        previous = next;
      }
      expect(mocks.call).not.toHaveBeenCalled();
    });
    it("keeps a built-in edition's lines when a running period's figures refresh", async () => {
      mocks.facts.mockResolvedValue({ ...snapshot, isPartial: true, generatedAt: Date.now() - 86_400_000 });
      await ensureRecapStory("owner@example.test", snapshot.period.id);
      // A New take's lines, picked to differ from the edition before, are the ones the next day keeps.
      const first = await ensureRecapStory("owner@example.test", snapshot.period.id, true);
      mocks.facts.mockResolvedValue({ ...snapshot, isPartial: true, generatedAt: Date.now(), income: 200000 });
      const next = await ensureRecapStory("owner@example.test", snapshot.period.id);
      expect(next.snapshot.income).toBe(200000); expect(next.seed).toBe(first.seed);
      expect(next.copy.headline).toBe(first.copy.headline);
      // Bodies carry the day's figures, and the overview's headline follows its verified observation; the other lines stay.
      const heading = (story: typeof first, id: string) => { const found = story.copy.chapters.find(chapter => chapter.id === id)!; return `${found.eyebrow} / ${found.title}`; };
      for (const chapter of first.copy.chapters.filter(item => item.id !== "overview")) expect(heading(next, chapter.id)).toBe(heading(first, chapter.id));
    });
  });
  it("offers many built-in lines, each fitting a portrait slide even with the longest labels", () => {
    const long = "W".repeat(40);
    const shapes = [snapshot,
      { ...snapshot, isPartial: true, period: { ...snapshot.period, name: "P".repeat(50) },
        categories: [{ name: long, amount: 50000 }, { name: `${long}2`, amount: 20000 }, { name: "C", amount: 10000 }, { name: "D", amount: 5000 }],
        highlights: { ...snapshot.highlights, repeatPurchases: [{ description: long, occurrences: 4, totalAmount: 9000, category: "Food" }] },
        largestPurchase: { description: long, amount: 60000, date: Date.UTC(2026, 7, 2) },
        budget: { planned: 1, spent: 2, remaining: -1, percentUsed: 200, categoryCount: 2, unbudgetedExpenses: 0, overBudgetCategoryCount: 2,
          overBudgetCategories: [{ name: long, planned: 1, spent: 2, over: 1 }] } },
      { ...snapshot, categories: [], highlights: undefined, largestPurchase: null, purchaseProfile: null, purchaseCount: 0, spendingDays: 0,
        budget: { planned: 5, spent: 5, remaining: 0, percentUsed: 100, categoryCount: 1, unbudgetedExpenses: 0, overBudgetCategoryCount: 0, overBudgetCategories: [] } },
    ];
    const unfinished = /(?:\b(?:and|with|at)|[,;:]|…|\.\.\.)\s*$/i;
    for (const shape of shapes) {
      const intros = new Set<string>(); const headlines = new Set<string>();
      for (let seed = 0; seed < 400; seed += 1) {
        const copy = fallbackRecapCopy(shape as typeof snapshot, seed, "N".repeat(30));
        intros.add(copy.chapters[0].title); headlines.add(copy.headline);
        expect(copy.chapters.map(chapter => chapter.id)).toEqual(["intro", "overview", "budget", "categories", "spotlight", "variety", "rhythm", "purchases", "peak", "moment", "balance", "comparison", "closing"]);
        expect(copy.headline.length).toBeLessThanOrEqual(64); expect(copy.deck.length).toBeLessThanOrEqual(160);
        expect(copy.headline).not.toMatch(unfinished);
        for (const chapter of copy.chapters) {
          expect(chapter.eyebrow.length, chapter.eyebrow).toBeLessThanOrEqual(40);
          expect(chapter.title.length, chapter.title).toBeLessThanOrEqual(56);
          expect(chapter.body.length, chapter.body).toBeLessThanOrEqual(160);
          expect(chapter.title, chapter.title).not.toMatch(unfinished);
          expect(chapter.body).not.toMatch(/undefined|null|NaN/);
        }
      }
      expect(intros.size).toBeGreaterThanOrEqual(7); expect(headlines.size).toBeGreaterThanOrEqual(5);
    }
  });
  describe("a period that is still running", () => {
    const yesterday = Date.now() - 86_400_000;
    const running = { ...snapshot, isPartial: true, generatedAt: yesterday };
    it("refreshes the figures on a new day under the same words, without another provider call", async () => {
      mocks.facts.mockResolvedValue(running);
      const first = await ensureRecapStory("owner@example.test", snapshot.period.id);
      expect(first.source).toBe("ai"); expect(first.draft).toBe(JSON.stringify(library())); expect(first.notice).toBeNull();
      mocks.facts.mockResolvedValue({ ...running, generatedAt: Date.now(), income: 200000, net: 130000 });
      const next = await ensureRecapStory("owner@example.test", snapshot.period.id);
      expect(next.snapshot.income).toBe(200000);
      expect(next.snapshot.generatedAt).toBeGreaterThan(yesterday);
      expect(next.copy.headline).toBe(first.copy.headline); expect(next.seed).toBe(first.seed); expect(next.source).toBe("ai");
      expect(next.savedAt).toBeGreaterThanOrEqual(first.savedAt);
      expect(mocks.call).toHaveBeenCalledTimes(1);
      expect(getSavedRecapStory("owner@example.test", snapshot.period.id)).toEqual(next);
    });
    it("keeps the same day's edition as it is", async () => {
      mocks.facts.mockResolvedValue({ ...running, generatedAt: Date.now() });
      const first = await ensureRecapStory("owner@example.test", snapshot.period.id);
      mocks.facts.mockResolvedValue({ ...running, generatedAt: Date.now(), income: 1 });
      expect(await ensureRecapStory("owner@example.test", snapshot.period.id)).toEqual(first);
      expect(mocks.facts).toHaveBeenCalledTimes(1);
    });
    it("writes new words when what the story quotes has changed", async () => {
      mocks.facts.mockResolvedValue(running);
      await ensureRecapStory("owner@example.test", snapshot.period.id);
      mocks.facts.mockResolvedValue({ ...running, generatedAt: Date.now(), categories: [{ name: "Travel", amount: 90000 }] });
      mocks.call.mockResolvedValue(JSON.stringify({ ...library(), headline: "{category1} took the wheel." }));
      const next = await ensureRecapStory("owner@example.test", snapshot.period.id);
      expect(mocks.call).toHaveBeenCalledTimes(2);
      expect(next.copy.headline).toBe("Travel took the wheel."); expect(next.source).toBe("ai"); expect(next.notice).toBeNull();
    });
    it("still refreshes the figures when the provider is out of credits, and says so without quoting it", async () => {
      mocks.facts.mockResolvedValue(running);
      await ensureRecapStory("owner@example.test", snapshot.period.id);
      mocks.facts.mockResolvedValue({ ...running, generatedAt: Date.now(), income: 200000, categories: [{ name: "Travel", amount: 90000 }] });
      mocks.call.mockRejectedValue(new Error('OpenRouter API error: {"error":{"message":"Insufficient credits. Add more at openrouter.ai","code":402}}'));
      const next = await ensureRecapStory("owner@example.test", snapshot.period.id);
      expect(next.snapshot.income).toBe(200000); expect(next.source).toBe("template");
      expect(next.notice).toContain("is out of credits"); expect(next.notice).toContain("Fainens edit");
      expect(next.notice).not.toContain("openrouter.ai");
      expect(next.copy.chapters.find(chapter => chapter.id === "spotlight")?.title).toContain("Travel");
    });
    it("tries the provider again on the next day after a fallback", async () => {
      mocks.call.mockRejectedValue(new Error("provider unavailable"));
      mocks.facts.mockResolvedValue(running);
      const first = await ensureRecapStory("owner@example.test", snapshot.period.id);
      expect(first.source).toBe("template"); expect(first.notice).toContain("didn’t answer");
      mocks.call.mockResolvedValue(JSON.stringify(library()));
      mocks.facts.mockResolvedValue({ ...running, generatedAt: Date.now() });
      const next = await ensureRecapStory("owner@example.test", snapshot.period.id);
      expect(next.source).toBe("ai"); expect(next.notice).toBeNull(); expect(mocks.call).toHaveBeenCalledTimes(2);
    });
    it("refreshes a legacy edition saved without a draft by writing it again", async () => {
      const legacy = { snapshot: running, seed: 1, savedAt: 1, source: "ai", copy: library() };
      mocks.client.prepare("INSERT INTO recap_period_story VALUES (?, ?, ?, ?)").run("owner@example.test", snapshot.period.id, JSON.stringify(legacy), 1);
      mocks.facts.mockResolvedValue({ ...running, generatedAt: Date.now() });
      const next = await ensureRecapStory("owner@example.test", snapshot.period.id);
      expect(next.snapshot.generatedAt).toBeGreaterThan(yesterday); expect(next.draft).toBeTruthy();
      expect(mocks.call).toHaveBeenCalledTimes(1);
    });
  });
  it("uses the fact-based rewrite when the model returns generic or invalid copy", async () => {
    await ensureRecapStory("owner@example.test", snapshot.period.id);
    const generic = library();
    generic.chapters.find(chapter => chapter.id === "purchases")!.body = "A collection of purchase moments.";
    mocks.call.mockResolvedValue(JSON.stringify(generic));
    const next = await ensureRecapStory("owner@example.test", snapshot.period.id, true);
    expect(next.source).toBe("template");
    expect(next.copy.chapters.find(chapter => chapter.id === "purchases")?.body).toContain("Train tickets");
    expect(next.copy.chapters.find(chapter => chapter.id === "moment")?.body).toContain("Secret purchase details");
  });
  it("caches a useful built-in edition when AI is unavailable, without automatic retries", async () => {
    mocks.call.mockRejectedValue(new Error("provider unavailable"));
    const first = await ensureRecapStory("owner@example.test", snapshot.period.id);
    expect(first.source).toBe("template");
    expect(await ensureRecapStory("owner@example.test", snapshot.period.id)).toEqual(first);
    expect(mocks.call).toHaveBeenCalledTimes(1);
  });
  it("works without any provider configuration", async () => {
    mocks.config.mockResolvedValue({ apiKey: undefined });
    const story = await ensureRecapStory("owner@example.test", snapshot.period.id);
    expect(story.source).toBe("template");
    expect(story.notice).toContain("Settings → Agent");
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("uses cached short display labels while preserving original purchase descriptions", async () => {
    const description = "Mie Lebar Ayam Tausi, Sweet Iced Tea, and Mango Pudding at Winglok Tebet Barat";
    const longSnapshot = { ...snapshot, largestPurchase: { ...snapshot.largestPurchase, description },
      highlights: { ...snapshot.highlights, topPurchases: [{ ...snapshot.highlights.topPurchases[0], description }] } };
    mocks.facts.mockResolvedValue(longSnapshot);
    const response = { ...library(), shortLabels: { purchase1: "Mie Tausi at Winglok", standoutPurchase: "Mie Tausi at Winglok" } };
    response.chapters.find(chapter => chapter.id === "intro")!.title = "Revisit {purchase1}.";
    mocks.call.mockResolvedValue(JSON.stringify(response));
    const saved = await ensureRecapStory("owner@example.test", snapshot.period.id);
    expect(saved.source).toBe("ai");
    expect(saved.copy.chapters[0].title).toBe("Revisit Mie Tausi at Winglok.");
    expect(saved.copy.shortLabels?.purchase1).toBe("Mie Tausi at Winglok");
    expect(saved.snapshot.highlights?.topPurchases?.[0].description).toBe(description);
    expect(await ensureRecapStory("owner@example.test", snapshot.period.id)).toEqual(saved);
    expect(mocks.call).toHaveBeenCalledTimes(1);
    const invented = { ...response, shortLabels: { purchase1: "Birthday dinner" } };
    expect(parseRecapCopy(JSON.stringify(invented), longSnapshot).shortLabels?.purchase1).toBe("Mie Lebar Ayam Tausi");
  });
  it("writes and caches a budget chapter tied to the observed category allocations", async () => {
    const budget = { planned: 100000, spent: 150000, remaining: -50000, percentUsed: 150,
      categoryCount: 1, unbudgetedExpenses: 20000, overBudgetCategoryCount: 1,
      overBudgetCategories: [{ name: 'Food', planned: 100000, spent: 150000, over: 50000 }] };
    mocks.facts.mockResolvedValue({ ...snapshot, budget, isPartial: true, generatedAt: Date.now(), coverageComplete: false });
    const response = library();
    response.chapters.find(chapter => chapter.id === 'budget')!.body = '{budgetCategory1} redrew its allocation line.';
    mocks.call.mockResolvedValue(JSON.stringify(response));
    const saved = await ensureRecapStory('owner@example.test', snapshot.period.id);
    expect(saved.source).toBe('ai');
    expect(saved.snapshot.budget).toEqual(budget);
    expect(saved.copy.chapters.find(chapter => chapter.id === 'budget')?.body).toBe('Food redrew its allocation line.');
    const context = JSON.parse(mocks.call.mock.calls[0][1]);
    expect(context.recap.budget).toMatchObject({ planned: 100000, spent: 150000, unbudgetedExpenses: 20000,
      overBudgetCategories: [{ name: '{budgetCategory1}', label: 'Food', over: 50000 }] });
    expect(await ensureRecapStory('owner@example.test', snapshot.period.id)).toEqual(saved);
    expect(mocks.call).toHaveBeenCalledTimes(1);
  });
  it("checks headline length after interpolation and rejects unfinished headlines", () => {
    const copy = library();
    copy.chapters[0].title = "A wonderfully specific return to {standoutPurchase}.";
    expect(copy.chapters[0].title.length).toBeLessThanOrEqual(56);
    expect(() => parseRecapCopy(JSON.stringify(copy), snapshot)).toThrow("portrait-slide");
    copy.chapters[0].title = "Revisit {purchase1} and";
    expect(() => parseRecapCopy(JSON.stringify(copy), snapshot)).toThrow("portrait-slide");
  });
  it('grounds the overview in matched history and caches the verified observation', async () => {
    const withHistory = { ...snapshot, income: 180000, purchaseCount: 15,
      baseline: { periodCount: 3, matchedElapsed: true, income: 120000, expenses: 60000, purchaseCount: 10 }, isPartial: true, generatedAt: Date.now() };
    mocks.facts.mockResolvedValue(withHistory);
    const saved = await ensureRecapStory('owner@example.test', snapshot.period.id);
    const overview = saved.copy.chapters.find(chapter => chapter.id === 'overview')!;
    expect(overview.body).toBe('Purchases rose 50%, while income rose 50% vs the average of 3 prior periods at the same point.');
    expect(overview.body.length).toBeLessThanOrEqual(160);
    expect(saved.snapshot.baseline).toEqual(withHistory.baseline);
    expect(JSON.parse(mocks.call.mock.calls[0][1]).recap.overview.changes).toEqual({ purchases: 50, income: 50, expenses: 17 });
    const generic = library(); generic.chapters.find(chapter => chapter.id === 'overview')!.body = 'Everyone gets a speaking part.';
    expect(() => parseRecapCopy(JSON.stringify(generic), withHistory)).toThrow('verified observation');
    expect(await ensureRecapStory('owner@example.test', snapshot.period.id)).toEqual(saved);
    expect(mocks.call).toHaveBeenCalledTimes(1);
  });
  it('observes the actual relationship without inventing history or savings', () => {
    expect(recapOverview({ ...snapshot, income: 13905742, expenses: 6556302, net: 7349440 }).body)
      .toBe('Expenses used 47% of recorded income, leaving a recorded surplus.');
    expect(recapOverview({ ...snapshot, income: 0, net: -70000 }).body).toContain('no positive income');
    expect(recapOverview({ ...snapshot, expenses: -10000 }).body).toContain('Expense credits');
    const incomplete = { ...snapshot, coverageComplete: false,
      baseline: { periodCount: 3, matchedElapsed: false, income: 1, expenses: 1, purchaseCount: 1 } };
    expect(recapOverview(incomplete).changes).toBeNull();
    expect(recapOverview(incomplete).body).not.toContain('prior');
    const zeroHistory = { ...snapshot, baseline: { periodCount: 1, matchedElapsed: false, income: 0, expenses: 0, purchaseCount: 0 } };
    expect(recapOverview(zeroHistory).body).not.toContain('Infinity');
    expect(recapOverview(zeroHistory).body).not.toContain('prior');
    expect(recapOverview({ ...zeroHistory, baseline: { ...zeroHistory.baseline, income: 100000 } }).body).toContain('vs a prior complete period');
  });
  it('gives repeats, the largest receipt, typical size and historical size distinct observations', () => {
    const period = { ...snapshot, baseline: { periodCount: 3, matchedElapsed: false, income: 100000,
      expenses: 40000, purchaseCount: 5, purchaseTotal: 30000 } };
    const insights = recapDetailInsights(period, { repeatPurchase1: 'Train tickets', standoutPurchase: 'Secret purchase details' });
    expect(insights.purchases.body).toContain('3 times, accounting for 30%');
    expect(insights.moment.body).toContain('28% of purchase spend');
    expect(insights.balance.body).toContain('1.8× the middle amount');
    expect(insights.comparison?.body).toBe('Average purchase size was 50% higher vs purchases across 3 prior periods.');
    expect(insights.averageChange).toBe(50);
    expect(recapDetailInsights(snapshot, {}).comparison).toBeNull();
    expect(recapDetailInsights({ ...period, coverageComplete: false }, {}).comparison).toBeNull();
    for (const insight of [insights.purchases, insights.moment, insights.balance, insights.comparison!]) {
      expect(insight.title.length).toBeLessThanOrEqual(56);
      expect(insight.body.length).toBeLessThanOrEqual(160);
    }
  });
  it("rejects generic purchase copy, invented numbers, unknown placeholders, duplicate chapters and broken JSON", () => {
    const generic = library();
    generic.chapters.find(chapter => chapter.id === "purchases")!.body = "A collection of moments.";
    expect(() => parseRecapCopy(JSON.stringify(generic), snapshot)).toThrow();
    const specific = library();
    expect(parseRecapCopy(JSON.stringify(specific), snapshot).chapters.find(chapter => chapter.id === "purchases")?.body).toContain("Train tickets");
    const numeric = library(); numeric.chapters[0].body = "You saved 80% this period.";
    expect(() => parseRecapCopy(JSON.stringify(numeric), snapshot)).toThrow();
    expect(() => parseRecapCopy(JSON.stringify({ ...library(), headline: "{salary}" }), snapshot)).toThrow();
    const duplicate = library(); duplicate.chapters[1].id = "intro";
    expect(() => parseRecapCopy(JSON.stringify(duplicate), snapshot)).toThrow();
    expect(() => parseRecapCopy("no json", snapshot)).toThrow();
  });
});
