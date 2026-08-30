import { describe, expect, it } from "vitest";

import { selectInitialToolGroups, toolNamesForGroups } from "./agent-tool-routing";

describe("agent tool routing", () => {
  it("keeps casual conversation tool-light", () => {
    expect([...selectInitialToolGroups("hello, thanks!")]).toEqual([]);
  });

  it("routes an explicit split receipt without loading transaction preparation", () => {
    const groups = selectInitialToolGroups("split bill this receipt between me and Inas", "", true);
    expect(groups.has("split_bill")).toBe(true);
    expect(groups.has("transactions")).toBe(false);
  });

  it("routes transaction preparation and exposes its required lookup tools", () => {
    const names = toolNamesForGroups(selectInitialToolGroups("record a 50k coffee expense from BNI"));
    expect(names.has("prepare_transaction")).toBe(true);
    expect(names.has("get_account_balances")).toBe(true);
    expect(names.has("get_categories")).toBe(true);
  });

  it("uses history to preserve an active proposal workflow", () => {
    const groups = selectInitialToolGroups("change that to Tuesday", "PENDING TRANSACTION PROPOSALS");
    expect(groups.has("transactions")).toBe(true);
  });
});
