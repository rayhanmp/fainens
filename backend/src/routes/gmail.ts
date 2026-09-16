import type { FastifyInstance, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { env } from "../lib/env";
import { db } from "../db/client";
import { gmailConnections } from "../db/schema";
import {
  decryptGmailRefreshToken,
  encryptGmailRefreshToken,
  getGmailProfile,
  revokeGmailToken,
} from "../services/gmail";
import { syncGmailConnection } from "../services/gmail-sync";

const errorSchema = z.object({ error: z.string() }).passthrough();
const statusSchema = z.object({
  connected: z.boolean(),
  email: z.string().email().nullable(),
  lastSyncedAt: z.union([z.date(), z.string(), z.number()]).nullable(),
}).passthrough();
const syncBodySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).passthrough();
const syncResponseSchema = z.object({
  connected: z.literal(true),
  imported: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  pendingIds: z.array(z.number().int()),
  lastSyncedAt: z.union([z.date(), z.string(), z.number()]),
}).passthrough();

function ownerEmail(request: FastifyRequest): string {
  const sessionEmail = (request.user as { email: string }).email.toLowerCase();

  // Local auth bypass uses a synthetic session email. Keep Gmail connections
  // owned by the configured Fainens account while still validating the actual
  // Google profile against ALLOWED_EMAIL below.
  return env.LOCAL_AUTH_BYPASS ? env.ALLOWED_EMAIL.toLowerCase() : sessionEmail;
}

function frontendRedirect(status: "connected" | "error"): string {
  const target = new URL("/transactions", env.FRONTEND_URL ?? new URL(env.GOOGLE_CALLBACK_URL).origin);
  target.searchParams.set("gmail", status);
  return target.toString();
}

export default async function gmailRoutes(fastify: FastifyInstance) {
  // Start the incremental Gmail consent flow only for an already signed-in
  // Fainens user. The OAuth plugin itself protects state with a cookie.
  fastify.get("/api/integrations/gmail/connect", {
    onRequest: [fastify.authenticate],
    schema: { operationId: "connectGmail", tags: ["integrations"], response: { 302: z.unknown(), 401: errorSchema } },
  }, async (request, reply) => {
    const authorizationUri = await fastify.googleGmailOAuth2.generateAuthorizationUri(request, reply);
    return reply.redirect(authorizationUri);
  });

  fastify.get("/api/integrations/gmail/callback", {
    onRequest: [fastify.authenticate],
    schema: { operationId: "handleGmailCallback", tags: ["integrations"], response: { 302: z.unknown(), 403: errorSchema, 500: errorSchema } },
  }, async (request, reply) => {
    try {
      const result = await fastify.googleGmailOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
      const raw = result as unknown as Record<string, unknown>;
      const token = (raw.token && typeof raw.token === "object" ? raw.token : raw) as { access_token?: string; refresh_token?: string };
      if (!token.access_token) return reply.code(500).send({ error: "Gmail authorization did not return an access token" });

      const signedInEmail = ownerEmail(request);
      const profile = await getGmailProfile(token.access_token);
      if (profile.emailAddress.toLowerCase() !== env.ALLOWED_EMAIL.toLowerCase()) {
        return reply.code(403).send({ error: "Connected Gmail account is not the authorized Fainens account" });
      }

      const [existing] = await db.select({ refreshToken: gmailConnections.refreshToken })
        .from(gmailConnections)
        .where(eq(gmailConnections.ownerEmail, signedInEmail))
        .limit(1);
      const refreshToken = token.refresh_token ?? existing?.refreshToken;
      if (!refreshToken) return reply.code(500).send({ error: "Google did not return a refresh token; please connect Gmail again" });

      await db.insert(gmailConnections).values({
        ownerEmail: signedInEmail,
        googleEmail: profile.emailAddress,
        refreshToken: encryptGmailRefreshToken(refreshToken),
      }).onConflictDoUpdate({
        target: gmailConnections.ownerEmail,
        set: { googleEmail: profile.emailAddress, refreshToken: encryptGmailRefreshToken(refreshToken), updatedAt: new Date() },
      });
      return reply.redirect(frontendRedirect("connected"));
    } catch (error) {
      fastify.log.error({ err: error }, "Gmail OAuth callback failed");
      return reply.redirect(frontendRedirect("error"));
    }
  });

  fastify.get("/api/integrations/gmail/status", {
    onRequest: [fastify.authenticate],
    schema: { operationId: "getGmailStatus", tags: ["integrations"], response: { 200: statusSchema, 401: errorSchema } },
  }, async (request) => {
    const [connection] = await db.select({ googleEmail: gmailConnections.googleEmail, lastSyncedAt: gmailConnections.lastSyncedAt })
      .from(gmailConnections)
      .where(eq(gmailConnections.ownerEmail, ownerEmail(request).toLowerCase()))
      .limit(1);
    return {
      connected: Boolean(connection),
      email: connection?.googleEmail ?? null,
      lastSyncedAt: connection?.lastSyncedAt ?? null,
    };
  });

  fastify.delete("/api/integrations/gmail", {
    onRequest: [fastify.authenticate],
    schema: { operationId: "disconnectGmail", tags: ["integrations"], response: { 204: z.unknown(), 401: errorSchema } },
  }, async (request, reply) => {
    const [connection] = await db.select({ refreshToken: gmailConnections.refreshToken })
      .from(gmailConnections)
      .where(eq(gmailConnections.ownerEmail, ownerEmail(request).toLowerCase()))
      .limit(1);
    if (connection) {
      try {
        await revokeGmailToken(decryptGmailRefreshToken(connection.refreshToken));
      } catch (error) {
        // Removing the local credential is still the important guarantee. The
        // user can revoke a stale grant later from Google Account settings.
        fastify.log.warn({ err: error }, "Could not revoke Gmail grant during disconnect");
      }
    }
    await db.delete(gmailConnections)
      .where(eq(gmailConnections.ownerEmail, ownerEmail(request).toLowerCase()));
    return reply.code(204).send();
  });

  fastify.post("/api/integrations/gmail/sync", {
    onRequest: [fastify.authenticate],
    schema: { operationId: "syncGmailTransactions", tags: ["integrations"], body: syncBodySchema, response: { 200: syncResponseSchema, 401: errorSchema, 409: errorSchema, 502: errorSchema } },
  }, async (request, reply) => {
    const body = request.body as { days: number };
    try {
      const result = await syncGmailConnection(ownerEmail(request), body.days);
      if (!result) return reply.code(409).send({ error: "Gmail is not connected" });
      return { connected: true as const, ...result };
    } catch (error) {
      fastify.log.error({ err: error }, "Gmail sync failed");
      return reply.code(502).send({ error: "Could not read Gmail. Please reconnect Gmail if authorization expired." });
    }
  });
}
