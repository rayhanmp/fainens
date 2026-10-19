import { FastifyInstance } from "fastify";
import { z } from "zod";

import { processStorageDeletionOutbox } from "../services/storage-cleanup";
import { TransactionMutationError } from "../services/transaction-mutations";
import {
  createBatch,
  discardBatch,
  getBatch,
  getBatchBalanceAt,
  getBatchSettlement,
  listBatches,
  postBatchDrafts,
  type BatchSettlementInput,
} from "../services/transaction-batches";

const batchErrorSchema = z.object({ error: z.string() }).passthrough();
const batchIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const batchSummarySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  source: z.string(),
  status: z.string(),
  note: z.string().nullable(),
  createdAt: z.number(),
  postedAt: z.number().nullable(),
  draftCount: z.number().int().nonnegative(),
  postedCount: z.number().int().nonnegative(),
}).passthrough();
const batchDetailSchema = batchSummarySchema.extend({
  accountImpact: z.array(z.object({
    accountId: z.number().int(),
    accountName: z.string(),
    deltaCents: z.number().int(),
    draftCount: z.number().int().nonnegative(),
  }).passthrough()),
  periods: z.array(z.object({
    periodId: z.number().int().nullable(),
    periodName: z.string().nullable(),
    status: z.string().nullable(),
    draftCount: z.number().int().nonnegative(),
  }).passthrough()),
  dateRange: z.object({ from: z.number(), to: z.number() }).nullable(),
}).passthrough();
const createBatchBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  source: z.string().trim().min(1).max(80).optional(),
  note: z.string().max(1000).nullable().optional(),
}).passthrough();
const settlementSchema = z.discriminatedUnion("mode", [
  z.object({ accountId: z.number().int().positive(), mode: z.literal("keep_current"), asOfDate: z.number().int().nonnegative() }),
  z.object({ accountId: z.number().int().positive(), mode: z.literal("match"), asOfDate: z.number().int().nonnegative(), actualBalance: z.number().int() }),
]);
const postBatchBodySchema = z.object({
  /** Post only these drafts; omitted posts every draft in the batch. */
  transactionIds: z.array(z.number().int().positive()).max(1000).optional(),
  /** Balance adjustments to post in the same commit, at most one per account. */
  settlements: z.array(settlementSchema).max(100).optional(),
}).passthrough();
const postBatchResponseSchema = z.object({
  posted: z.array(z.number().int()),
  failed: z.array(z.object({ id: z.number().int(), error: z.string() }).passthrough()),
  reopenedPeriodIds: z.array(z.number().int()),
  batchStatus: z.string(),
  settlements: z.array(z.object({ accountId: z.number().int(), difference: z.number().int(), transactionId: z.number().int().nullable() }).passthrough()),
}).passthrough();
const settlementResponseSchema = z.object({
  accounts: z.array(z.object({
    accountId: z.number().int(),
    accountName: z.string(),
    accountType: z.enum(["asset", "liability"]),
    currentBalance: z.number().int(),
    batchDelta: z.number().int(),
    draftCount: z.number().int().nonnegative(),
    firstDraftDate: z.number(),
    lastDraftDate: z.number(),
    adjustments: z.array(z.object({ sessionId: z.number().int(), kind: z.string(), asOfDate: z.number(), difference: z.number().int() }).passthrough()),
  }).passthrough()),
}).passthrough();
const balanceAtQuerySchema = z.object({
  accountId: z.coerce.number().int().positive(),
  asOfDate: z.coerce.number().int().nonnegative(),
});
const balanceAtResponseSchema = z.object({ postedBalance: z.number().int(), draftDelta: z.number().int() }).passthrough();
const discardResponseSchema = z.object({ success: z.literal(true), deletedCount: z.number().int().nonnegative() }).passthrough();

function errorStatus(err: unknown): 400 | 404 | 409 | 500 {
  const status = err instanceof TransactionMutationError ? err.statusCode : 500;
  return status === 400 || status === 404 || status === 409 ? status : 500;
}

/**
 * Batches group drafts prepared together, such as a statement backfill, so they can be reviewed,
 * posted into the ledger or discarded as one unit. The drafts themselves are ordinary transactions
 * with status "draft", read and edited through the transaction endpoints.
 */
export default async function transactionBatchRoutes(fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/transaction-batches", {
    schema: { operationId: "listTransactionBatches", tags: ["transaction-batches"], response: { 200: z.array(batchSummarySchema) } },
  }, async () => listBatches());

  fastify.post("/api/transaction-batches", {
    schema: { operationId: "createTransactionBatch", tags: ["transaction-batches"], body: createBatchBodySchema, response: { 201: batchSummarySchema, 400: batchErrorSchema, 404: batchErrorSchema, 409: batchErrorSchema, 500: batchErrorSchema } },
  }, async (request, reply) => {
    try {
      const batch = await createBatch(request.body as { name: string; source?: string; note?: string | null });
      return reply.code(201).send(batch);
    } catch (err) {
      fastify.log.error(err);
      return reply.code(errorStatus(err)).send({ error: err instanceof Error ? err.message : "Failed to create batch" });
    }
  });

  fastify.get("/api/transaction-batches/:id", {
    schema: { operationId: "getTransactionBatch", tags: ["transaction-batches"], params: batchIdParamsSchema, response: { 200: batchDetailSchema, 400: batchErrorSchema, 404: batchErrorSchema, 409: batchErrorSchema, 500: batchErrorSchema } },
  }, async (request, reply) => {
    try {
      return await getBatch((request.params as { id: number }).id);
    } catch (err) {
      return reply.code(errorStatus(err)).send({ error: err instanceof Error ? err.message : "Failed to load batch" });
    }
  });

  fastify.get("/api/transaction-batches/:id/settlement", {
    schema: { operationId: "getTransactionBatchSettlement", tags: ["transaction-batches"], params: batchIdParamsSchema, response: { 200: settlementResponseSchema, 400: batchErrorSchema, 404: batchErrorSchema, 409: batchErrorSchema, 500: batchErrorSchema } },
  }, async (request, reply) => {
    try {
      return await getBatchSettlement((request.params as { id: number }).id);
    } catch (err) {
      return reply.code(errorStatus(err)).send({ error: err instanceof Error ? err.message : "Failed to load the settlement" });
    }
  });

  fastify.get("/api/transaction-batches/:id/balance-at", {
    schema: { operationId: "getTransactionBatchBalanceAt", tags: ["transaction-batches"], params: batchIdParamsSchema, querystring: balanceAtQuerySchema, response: { 200: balanceAtResponseSchema, 400: batchErrorSchema, 404: batchErrorSchema, 409: batchErrorSchema, 500: batchErrorSchema } },
  }, async (request, reply) => {
    try {
      const { accountId, asOfDate } = request.query as { accountId: number; asOfDate: number };
      return await getBatchBalanceAt((request.params as { id: number }).id, accountId, asOfDate);
    } catch (err) {
      return reply.code(errorStatus(err)).send({ error: err instanceof Error ? err.message : "Failed to read the balance" });
    }
  });

  fastify.post("/api/transaction-batches/:id/post", {
    schema: { operationId: "postTransactionBatch", tags: ["transaction-batches"], params: batchIdParamsSchema, body: postBatchBodySchema, response: { 200: postBatchResponseSchema, 400: batchErrorSchema, 404: batchErrorSchema, 409: batchErrorSchema, 500: batchErrorSchema } },
  }, async (request, reply) => {
    try {
      const { transactionIds, settlements } = request.body as { transactionIds?: number[]; settlements?: BatchSettlementInput[] };
      return await postBatchDrafts((request.params as { id: number }).id, transactionIds, settlements ?? []);
    } catch (err) {
      fastify.log.error(err);
      return reply.code(errorStatus(err)).send({ error: err instanceof Error ? err.message : "Failed to post batch" });
    }
  });

  fastify.delete("/api/transaction-batches/:id", {
    schema: { operationId: "discardTransactionBatch", tags: ["transaction-batches"], params: batchIdParamsSchema, response: { 200: discardResponseSchema, 400: batchErrorSchema, 404: batchErrorSchema, 409: batchErrorSchema, 500: batchErrorSchema } },
  }, async (request, reply) => {
    try {
      const result = await discardBatch((request.params as { id: number }).id);
      if (result.outboxIds.length > 0) void processStorageDeletionOutbox(result.outboxIds);
      return { success: true as const, deletedCount: result.deletedCount };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(errorStatus(err)).send({ error: err instanceof Error ? err.message : "Failed to discard batch" });
    }
  });
}
