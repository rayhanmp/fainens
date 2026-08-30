import { describe, expect, it } from "vitest";

import { parseAgentPresentation } from "./agent-presentations";

describe("agent presentations", () => {
  it("validates and defaults a split bill", () => {
    const presentation = parseAgentPresentation("show_split_bill", {
      type: "split_bill",
      title: "Dinner split",
      participants: [{ id: "me", name: "Ray" }, { id: "inas", name: "Inas" }],
      items: [{ id: "item-1", name: "Niku-don", quantity: 1, amount: 80_000, participantIds: ["inas"] }],
      charges: { tax: 8_000, service: 4_000, discount: 0, tip: 0 },
      payerId: "me",
    });
    expect(presentation.type).toBe("split_bill");
    if (presentation.type === "split_bill") {
      expect(presentation.charges.taxRule).toBe("proportional");
      expect(presentation.charges.tipRule).toBe("payer");
      expect(presentation.participants[0]?.name).toBe("Ray");
    }
  });

  it("rejects unknown split-bill participants", () => {
    expect(() => parseAgentPresentation("show_split_bill", {
      type: "split_bill",
      title: "Broken split",
      participants: [{ id: "me", name: "Ray" }],
      items: [{ id: "item-1", name: "Meal", quantity: 1, amount: 50_000, participantIds: ["missing"] }],
      charges: { tax: 0, service: 0, discount: 0, tip: 0 },
    })).toThrow(/Unknown participant/);
  });

  it("rejects malformed chart data", () => {
    expect(() => parseAgentPresentation("show_chart", { type: "donut", title: "Empty", unit: "IDR", items: [{ label: "Food", value: 0 }] })).toThrow();
  });
});
