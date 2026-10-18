import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
const mocks = vi.hoisted(() => ({ recognize: vi.fn(), settle: vi.fn() }));
vi.mock("../services/paylater", () => ({
  recognizePaylaterPurchase: mocks.recognize,
  settlePaylaterPayment: mocks.settle,
  recordPaylaterInterest: vi.fn(),
  reversePaylaterTransaction: vi.fn(),
  getPaylaterSummary: vi.fn(),
  getPaylaterObligations: vi.fn(),
}));
import paylaterRoutes from "./paylater";

const settleBody = { description: "Payment", paymentAmount: 100_000, paylaterLiabilityAccountId: 2, bankAccountId: 1, originalTxId: 9 };
const recognizeBody = { description: "Phone", principalAmount: 300_000, paylaterLiabilityAccountId: 2, installmentMonths: 3, firstDueDate: 1_790_000_000_000 };

describe("PayLater API", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.resetAllMocks();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate("authenticate", async () => {});
    await app.register(paylaterRoutes);
  });
  afterEach(async () => { await app.close(); });
  const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload });

  it("answers successful writes with the 200 the schema declares", async () => {
    mocks.settle.mockResolvedValue({ transactionId: 41 });
    mocks.recognize.mockResolvedValue({ transactionId: 40, installments: [] });
    const settled = await post("/api/paylater/settle", settleBody);
    expect([settled.statusCode, settled.json()]).toEqual([200, { transactionId: 41 }]);
    const recognized = await post("/api/paylater/recognize", recognizeBody);
    expect([recognized.statusCode, recognized.json()]).toEqual([200, { transactionId: 40, installments: [] }]);
  });

  it("explains validation failures such as an over-payment", async () => {
    mocks.settle.mockRejectedValue(new Error("Payment exceeds outstanding paylater liability (0)"));
    const response = await post("/api/paylater/settle", settleBody);
    expect([response.statusCode, response.json()]).toEqual([400, { error: "Payment exceeds outstanding paylater liability (0)" }]);
  });

  it("keeps driver errors generic", async () => {
    class SqliteError extends Error {}
    mocks.recognize.mockRejectedValue(new SqliteError("UNIQUE constraint failed: transaction.id"));
    const response = await post("/api/paylater/recognize", recognizeBody);
    expect([response.statusCode, response.json()]).toEqual([400, { error: "Failed to recognize paylater purchase" }]);
  });
});
