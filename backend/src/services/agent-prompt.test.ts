import { describe, expect, it } from "vitest";

import { AGENT_SYSTEM_PROMPT, buildAgentSystemPrompt } from "./agent-prompt";

describe("agent prompt", () => {
  it("keeps the stable policy prompt compact", () => {
    expect(AGENT_SYSTEM_PROMPT.length).toBeLessThan(4_500);
    expect(AGENT_SYSTEM_PROMPT).not.toContain("fainens-viz");
    expect(AGENT_SYSTEM_PROMPT).not.toContain("split_bill {");
    expect(AGENT_SYSTEM_PROMPT).toContain("Preparation tools create review proposals only");
  });

  it("puts sanitized dynamic context after the stable prefix", () => {
    const prompt = buildAgentSystemPrompt(1_788_079_896_031, [{ label: "Habit\n", content: "Works  remotely\u0000" }], "Ray\n");
    expect(prompt.startsWith(AGENT_SYSTEM_PROMPT)).toBe(true);
    expect(prompt).toContain('Preferred name: "Ray"');
    expect(prompt).toContain("Habit: Works remotely");
    expect(prompt).not.toContain("\u0000");
  });
});
