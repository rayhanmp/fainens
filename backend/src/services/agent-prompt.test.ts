import { describe, expect, it } from "vitest";

import { AGENT_SYSTEM_PROMPT, buildAgentPromptMessages, buildAgentSystemPrompt } from "./agent-prompt";

describe("agent prompt", () => {
  it("keeps the stable policy prompt compact", () => {
    expect(AGENT_SYSTEM_PROMPT.length).toBeLessThan(4_500);
    expect(AGENT_SYSTEM_PROMPT).not.toContain("fainens-viz");
    expect(AGENT_SYSTEM_PROMPT).not.toContain("split_bill {");
    expect(AGENT_SYSTEM_PROMPT).toContain("Preparation tools create review proposals only");
    expect(AGENT_SYSTEM_PROMPT).toContain("Proactively use a structured presentation");
    expect(AGENT_SYSTEM_PROMPT).toContain("name calculate");
    expect(AGENT_SYSTEM_PROMPT).toContain("Reuse CURRENT COMPACT EVIDENCE STATE");
    expect(AGENT_SYSTEM_PROMPT).toContain("do not re-read merely because a fact is mutable");
  });

  it("puts sanitized dynamic context after the stable prefix", () => {
    const prompt = buildAgentSystemPrompt(1_788_079_896_031, [{ label: "Habit\n", content: "Works  remotely\u0000" }], "Ray\n", null, null, [], ["BNI", "GoPay"]);
    expect(prompt.startsWith(AGENT_SYSTEM_PROMPT)).toBe(true);
    expect(prompt).toContain('Preferred name: "Ray"');
    expect(prompt).toContain("Habit: Works remotely");
    expect(prompt).toContain('["BNI","GoPay"]');
    expect(prompt).not.toContain("\u0000");
  });

  it("keeps policy, catalog, personalization and history identical when request context changes", () => {
    const history = [
      { role: "user" as const, content: "budget?" },
      { role: "assistant" as const, content: "Within budget." },
    ];
    const common = { profile: "Ray", catalog: '[{"name":"get_budget_breakdown"}]', history };
    const first = buildAgentPromptMessages({ ...common, nowMs: 1_788_079_896_031, availableAccountNames: ["BNI"], userContent: "again?" });
    const second = buildAgentPromptMessages({ ...common, nowMs: 1_788_080_896_031, availableAccountNames: ["GoPay"], userContent: "refresh" });
    expect(first.slice(0, 4)).toEqual(second.slice(0, 4));
    expect(first[0]?.content).toContain(common.catalog);
    expect(first[0]?.content).not.toContain("Local time");
    expect(first[1]?.content).not.toContain("Local time");
    expect(first[4]?.content).not.toEqual(second[4]?.content);
    expect(first[first.length - 1]).toEqual({ role: "user", content: "again?" });
  });

  it("places changing historical evidence after conversation history and preserves current image content", () => {
    const retained = { role: "system" as const, content: "CURRENT COMPACT EVIDENCE STATE (backend-retained read-only context): budget" };
    const priorUser = { role: "user" as const, content: "budget?" };
    const userContent = [{ type: "text" as const, text: "this receipt" }, { type: "image_url" as const, image_url: { url: "data:image/png;base64,example" } }];
    const messages = buildAgentPromptMessages({ nowMs: 1_788_079_896_031, history: [retained, priorUser], userContent });
    expect(messages[2]).toEqual(priorUser);
    expect(messages[3]).toEqual(retained);
    expect(messages[messages.length - 1]?.content).toBe(userContent);
  });

  it("normalizes retrieval order without moving volatile time ahead of the catalog", () => {
    const memories = [{ label: "B", content: "second" }, { label: "A", content: "first" }];
    const first = buildAgentSystemPrompt(1_788_079_896_031, memories, "Ray", "catalog", null, [], ["GoPay", "BNI"]);
    const second = buildAgentSystemPrompt(1_788_079_896_031, [...memories].reverse(), "Ray", "catalog", null, [], ["BNI", "GoPay"]);
    expect(first).toEqual(second);
    expect(first.indexOf("CAPABILITY CATALOG (")).toBeLessThan(first.indexOf("PROFILE CONTEXT ("));
    expect(first.indexOf("Local time (")).toBeGreaterThan(first.indexOf("AVAILABLE ACCOUNT NAMES"));
  });
});
