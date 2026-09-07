import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  approveReimbursementClaim,
  amendReimbursementApproval,
  createReimbursementClaim,
  getReimbursementClaim,
  listReimbursementClaims,
  recordReimbursementReceipt,
  ReimbursementError,
  reverseReimbursementApproval,
  reverseReimbursementReceipt,
  reverseReimbursementWriteOff,
  transitionReimbursementClaim,
  updateReimbursementClaim,
  writeOffReimbursementClaim,
} from "../services/reimbursements";

const errorSchema = z.object({ error: z.string() }).passthrough();
const claimIdParams = z.object({ id: z.coerce.number().int().positive() });
const sourceSchema = z.object({
  sourceTransactionId: z.number().int().positive(),
  expenseLineId: z.number().int().positive(),
  categoryId: z.number().int().positive().nullable().optional(),
  amount: z.number().int().positive(),
}).passthrough();
const claimBodySchema = z.object({
  contactId: z.number().int().positive(),
  title: z.string().trim().min(1).max(500),
  dueDate: z.number().int().positive().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  sources: z.array(sourceSchema).min(1).max(200),
}).passthrough();
const claimSchema = z.object({
  id: z.number().int(), contactId: z.number().int(), title: z.string(), status: z.string(), dueDate: z.union([z.date(), z.number(), z.string()]).nullable(), notes: z.string().nullable(),
  proposedAmount: z.number().int(), recognisedAmount: z.number().int(), outstandingAmount: z.number().int(), sources: z.array(z.unknown()), receipts: z.array(z.unknown()),
}).passthrough();
const idempotencySchema = z.object({ idempotencyKey: z.string().trim().min(8).max(200) }).passthrough();

function fail(reply: any, error: unknown) {
  const message = error instanceof Error ? error.message : "Reimbursement operation failed";
  const status = error instanceof ReimbursementError ? error.statusCode : 400;
  return reply.code(status).send({ error: message });
}

export default async function reimbursementRoutes(fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/reimbursements", {
    schema: { operationId: "listReimbursements", tags: ["reimbursements"], querystring: z.object({ status: z.string().max(40).optional(), contactId: z.coerce.number().int().positive().optional() }), response: { 200: z.array(claimSchema), 400: errorSchema } },
  }, async (request, reply) => {
    try {
      const query = request.query as { status?: string; contactId?: number };
      return await listReimbursementClaims(query);
    } catch (error) { return fail(reply, error); }
  });

  fastify.get("/api/reimbursements/:id", {
    schema: { operationId: "getReimbursement", tags: ["reimbursements"], params: claimIdParams, response: { 200: claimSchema, 404: errorSchema } },
  }, async (request, reply) => {
    try { return await getReimbursementClaim(Number((request.params as { id: number }).id)); }
    catch (error) { return fail(reply, error); }
  });

  fastify.post("/api/reimbursements", {
    schema: { operationId: "createReimbursement", tags: ["reimbursements"], body: claimBodySchema, response: { 201: claimSchema, 400: errorSchema, 404: errorSchema } },
  }, async (request, reply) => {
    try { return reply.code(201).send(await createReimbursementClaim(request.body as any)); }
    catch (error) { return fail(reply, error); }
  });

  fastify.patch("/api/reimbursements/:id", {
    schema: { operationId: "updateReimbursement", tags: ["reimbursements"], params: claimIdParams, body: claimBodySchema, response: { 200: claimSchema, 400: errorSchema, 404: errorSchema, 409: errorSchema } },
  }, async (request, reply) => {
    try { return await updateReimbursementClaim(Number((request.params as { id: number }).id), request.body as any); }
    catch (error) { return fail(reply, error); }
  });

  for (const action of ["submit", "reject", "cancel"] as const) {
    fastify.post(`/api/reimbursements/:id/${action}`, {
      schema: { operationId: `${action}Reimbursement`, tags: ["reimbursements"], params: claimIdParams, response: { 200: claimSchema, 400: errorSchema, 404: errorSchema, 409: errorSchema } },
    }, async (request, reply) => {
      try { return await transitionReimbursementClaim(Number((request.params as { id: number }).id), action); }
      catch (error) { return fail(reply, error); }
    });
  }

  fastify.post("/api/reimbursements/:id/approve", {
    schema: { operationId: "approveReimbursement", tags: ["reimbursements"], params: claimIdParams, body: idempotencySchema, response: { 200: z.object({ claimId: z.number().int(), recognitionTransactionIds: z.array(z.number().int()) }), 400: errorSchema, 404: errorSchema, 409: errorSchema } },
  }, async (request, reply) => {
    try {
      const body = request.body as { idempotencyKey: string };
      return await approveReimbursementClaim(Number((request.params as { id: number }).id), body.idempotencyKey);
    } catch (error) { return fail(reply, error); }
  });

  fastify.post("/api/reimbursements/:id/amend-approval", {
    schema: { operationId: "amendReimbursementApproval", tags: ["reimbursements"], params: claimIdParams, body: z.object({ sources: z.array(sourceSchema).min(1).max(200), idempotencyKey: z.string().trim().min(8).max(200) }), response: { 200: z.object({ claimId: z.number().int(), recognitionTransactionIds: z.array(z.number().int()) }), 400: errorSchema, 404: errorSchema, 409: errorSchema } },
  }, async (request, reply) => {
    try { return await amendReimbursementApproval({ claimId: Number((request.params as { id: number }).id), ...(request.body as any) }); }
    catch (error) { return fail(reply, error); }
  });

  fastify.post("/api/reimbursement-receipts", {
    schema: { operationId: "recordReimbursementReceipt", tags: ["reimbursements"], body: z.object({
      date: z.number().int().positive(), walletAccountId: z.number().int().positive(), notes: z.string().max(4000).nullable().optional(), idempotencyKey: z.string().trim().min(8).max(200),
      allocations: z.array(z.object({ claimId: z.number().int().positive(), amount: z.number().int().positive() })).min(1).max(100),
    }).passthrough(), response: { 201: z.object({ receiptId: z.number().int(), transactionId: z.number().int() }), 400: errorSchema, 404: errorSchema, 409: errorSchema } },
  }, async (request, reply) => {
    try { return reply.code(201).send(await recordReimbursementReceipt(request.body as any)); }
    catch (error) { return fail(reply, error); }
  });

  fastify.post("/api/reimbursement-receipts/:id/reverse", {
    schema: { operationId: "reverseReimbursementReceipt", tags: ["reimbursements"], params: claimIdParams, body: z.object({ reason: z.string().trim().min(1).max(1000), idempotencyKey: z.string().trim().min(8).max(200) }), response: { 200: z.object({ reversalTransactionId: z.number().int() }), 400: errorSchema, 404: errorSchema, 409: errorSchema } },
  }, async (request, reply) => {
    try {
      const body = request.body as { reason: string; idempotencyKey: string };
      return await reverseReimbursementReceipt(Number((request.params as { id: number }).id), body.reason, body.idempotencyKey);
    }
    catch (error) { return fail(reply, error); }
  });

  fastify.post("/api/reimbursements/:id/write-off", {
    schema: { operationId: "writeOffReimbursement", tags: ["reimbursements"], params: claimIdParams, body: z.object({ date: z.number().int().positive(), notes: z.string().max(4000).nullable().optional(), idempotencyKey: z.string().trim().min(8).max(200) }), response: { 200: z.object({ claimId: z.number().int(), transactionId: z.number().int(), amount: z.number().int() }), 400: errorSchema, 404: errorSchema, 409: errorSchema } },
  }, async (request, reply) => {
    try { return await writeOffReimbursementClaim({ claimId: Number((request.params as { id: number }).id), ...(request.body as any) }); }
    catch (error) { return fail(reply, error); }
  });

  fastify.post("/api/reimbursements/:id/reverse-approval", {
    schema: { operationId: "reverseReimbursementApproval", tags: ["reimbursements"], params: claimIdParams, body: z.object({ reason: z.string().trim().min(1).max(1000), idempotencyKey: z.string().trim().min(8).max(200) }), response: { 200: z.object({ claimId: z.number().int(), reversalTransactionIds: z.array(z.number().int()) }), 400: errorSchema, 404: errorSchema, 409: errorSchema } },
  }, async (request, reply) => {
    try { return await reverseReimbursementApproval({ claimId: Number((request.params as { id: number }).id), ...(request.body as any) }); }
    catch (error) { return fail(reply, error); }
  });

  fastify.post("/api/reimbursements/:id/reverse-write-off", {
    schema: { operationId: "reverseReimbursementWriteOff", tags: ["reimbursements"], params: claimIdParams, body: z.object({ reason: z.string().trim().min(1).max(1000), idempotencyKey: z.string().trim().min(8).max(200) }), response: { 200: z.object({ claimId: z.number().int(), reversalTransactionId: z.number().int() }), 400: errorSchema, 404: errorSchema, 409: errorSchema } },
  }, async (request, reply) => {
    try { return await reverseReimbursementWriteOff({ claimId: Number((request.params as { id: number }).id), ...(request.body as any) }); }
    catch (error) { return fail(reply, error); }
  });
}
