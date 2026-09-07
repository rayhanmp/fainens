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
      expect(presentation.calculation.total).toBe(92_000);
      expect(presentation.calculation.totals).toEqual({ me: 0, inas: 92_000 });
      expect(presentation.calculation.settlements).toEqual([{ fromId: "inas", fromName: "Inas", toId: "me", toName: "Ray", amount: 92_000 }]);
    }
  });

  it("allocates split-bill remainders deterministically", () => {
    const presentation = parseAgentPresentation("show_split_bill", {
      type: "split_bill",
      title: "Dinner",
      payerId: "ray",
      participants: [{ id: "ray", name: "Ray" }, { id: "inas", name: "Inas" }],
      items: [
        { id: "one", name: "Original Niku-Don", quantity: 1, amount: 58_000, participantIds: ["ray"] },
        { id: "two", name: "Truffle Niku-Don", quantity: 1, amount: 80_000, participantIds: ["inas"] },
      ],
      charges: { tax: 14_490, service: 6_900, discount: 0, tip: 0, taxRule: "proportional", serviceRule: "equal" },
    });
    expect(presentation.type).toBe("split_bill");
    if (presentation.type === "split_bill") {
      expect(presentation.calculation.total).toBe(159_390);
      expect(presentation.calculation.allocated).toBe(159_390);
      expect(presentation.calculation.totals).toEqual({ ray: 67_540, inas: 91_850 });
      expect(presentation.calculation.settlements[0]).toMatchObject({ fromId: "inas", toId: "ray", amount: 91_850 });
    }
  });

  it("calculates a shared item with proportional discounts and a friend payer", () => {
    const presentation = parseAgentPresentation("show_split_bill", {
      type: "split_bill",
      title: "Dinner",
      payerId: "inas",
      participants: [{ id: "ray", name: "Ray" }, { id: "inas", name: "Inas" }],
      items: [
        { id: "noodle", name: "Noodle", quantity: 1, amount: 32_000, participantIds: ["ray"] },
        { id: "rice", name: "Rice", quantity: 1, amount: 48_000, participantIds: ["inas"] },
        { id: "tea", name: "Tea", quantity: 2, amount: 20_000, participantIds: ["ray", "inas"] },
      ],
      charges: { tax: 9_000, service: 5_000, discount: 10_000, tip: 0, taxRule: "proportional", serviceRule: "equal", discountRule: "proportional" },
    });
    expect(presentation.type).toBe("split_bill");
    if (presentation.type === "split_bill") {
      expect(presentation.calculation.total).toBe(104_000);
      expect(presentation.calculation.totals).toEqual({ ray: 44_080, inas: 59_920 });
      expect(presentation.calculation.settlements[0]).toMatchObject({ fromId: "ray", toId: "inas", amount: 44_080 });
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

  it("strips irrelevant generic chart fields while validating the selected shape", () => {
    const presentation = parseAgentPresentation("show_chart", {
      type: "metric",
      title: "This month's spending",
      unit: "IDR",
      value: 1_250_000,
      tone: "neutral",
      items: [{ label: "Food", value: 400_000 }],
      spending: 1_250_000,
      periodLabel: "August 2026",
      subtitle: "Recorded spending",
    });
    expect(presentation).toMatchObject({ type: "metric", value: 1_250_000, subtitle: "Recorded spending" });
    expect(presentation).not.toHaveProperty("items");
    expect(presentation).not.toHaveProperty("spending");
  });
});
