import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cacheDelete: vi.fn(async () => true),
  cacheDeletePattern: vi.fn(async () => true),
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => true),
  bumpFinancialRevision: vi.fn(() => 7),
  getFinancialRevision: vi.fn(async () => 7),
  precomputeAccountBalance: vi.fn(async (accountId: number) => ({ accountId, balance: 123 })),
  precomputeNetWorth: vi.fn(async () => ({ totalAssets: 1, totalLiabilities: 0, netWorth: 1 })),
  precomputeBurnRate: vi.fn(async () => ({ grossBurnRate: 1, period: "month" })),
  precomputeRunway: vi.fn(async () => ({ runwayMonths: 1, isUnbounded: false, liquidAssets: 1 })),
  precomputeTrialBalance: vi.fn(async () => ({ totalDebits: 1, totalCredits: 1, isBalanced: true })),
  precomputePeriodSummary: vi.fn(async (periodId: number) => ({ periodId })),
}));

vi.mock("./redis", () => ({
  cacheDelete: mocks.cacheDelete,
  cacheDeletePattern: mocks.cacheDeletePattern,
  cacheGet: mocks.cacheGet,
  cacheSet: mocks.cacheSet,
}));
vi.mock("../services/financial-revision", () => ({
  bumpFinancialRevision: mocks.bumpFinancialRevision,
  getFinancialRevision: mocks.getFinancialRevision,
}));
vi.mock("./precompute", () => ({
  precomputeAccountBalance: mocks.precomputeAccountBalance,
  precomputeNetWorth: mocks.precomputeNetWorth,
  precomputeBurnRate: mocks.precomputeBurnRate,
  precomputeRunway: mocks.precomputeRunway,
  precomputeTrialBalance: mocks.precomputeTrialBalance,
  precomputePeriodSummary: mocks.precomputePeriodSummary,
}));

import {
  getAccountBalanceCached,
  invalidateOnTransactionMutation,
} from "./invalidation";

describe("cache invalidation boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cacheGet.mockResolvedValue(null);
    mocks.getFinancialRevision.mockResolvedValue(7);
  });

  it("bumps the revision only when the write transaction did not already do so", async () => {
    await invalidateOnTransactionMutation({
      transactionId: 9,
      affectedAccountIds: [2, 3],
      affectedPeriodIds: [18],
      revisionBumped: true,
    });
    expect(mocks.bumpFinancialRevision).not.toHaveBeenCalled();

    await invalidateOnTransactionMutation({
      transactionId: 10,
      affectedAccountIds: [4],
      affectedPeriodIds: [],
    });
    expect(mocks.bumpFinancialRevision).toHaveBeenCalledTimes(1);
  });

  it("invalidates every affected account, analytics, and period summary", async () => {
    await invalidateOnTransactionMutation({
      transactionId: 11,
      affectedAccountIds: [2, 3],
      affectedPeriodIds: [18, 19],
      revisionBumped: true,
    });

    expect(mocks.cacheDelete).toHaveBeenCalledWith("account:balance:2");
    expect(mocks.cacheDelete).toHaveBeenCalledWith("account:balance:3");
    expect(mocks.cacheDeletePattern).toHaveBeenCalledWith("analytics:*");
    expect(mocks.cacheDelete).toHaveBeenCalledWith("period:summary:18");
    expect(mocks.cacheDelete).toHaveBeenCalledWith("period:summary:19");
  });

  it("recomputes a stale account cache instead of returning stale data", async () => {
    mocks.cacheGet.mockResolvedValue({ balance: 999, revision: 6 } as never);
    const result = await getAccountBalanceCached(2);

    expect(result).toEqual(123);
    expect(mocks.precomputeAccountBalance).toHaveBeenCalledWith(2);
  });

  it("accepts a cache entry only when its revision matches", async () => {
    mocks.cacheGet.mockResolvedValue({ balance: 999, revision: 7 } as never);
    const result = await getAccountBalanceCached(2);

    expect(result).toEqual(999);
    expect(mocks.precomputeAccountBalance).not.toHaveBeenCalled();
  });
});
