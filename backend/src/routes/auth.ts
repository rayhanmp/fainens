import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { eq } from "drizzle-orm";
import csrf from "@fastify/csrf-protection";

import { env } from "../lib/env";
import { db } from "../db/client";
import { accounts, salaryPeriods } from "../db/schema";

export default async function (fastify: FastifyInstance) {
  // Register CSRF protection
  await fastify.register(csrf, {
    cookieOpts: { path: "/", sameSite: "strict", httpOnly: true, secure: env.NODE_ENV === "production" },
  });

  // CSRF token endpoint
  fastify.get("/api/auth/csrf-token", async (request: FastifyRequest, reply: FastifyReply) => {
    const token = await reply.generateCsrf();
    return { csrfToken: token };
  });

  // Google OAuth callback
  fastify.get("/api/auth/google/callback", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // @fastify/oauth2 may return either { token: { access_token } } or a flat shape depending on version
      const flowResult = await fastify.googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
      const raw = flowResult as unknown as Record<string, unknown>;
      let accessToken: string | undefined;
      if (raw.token && typeof raw.token === "object" && raw.token !== null) {
        const t = raw.token as Record<string, unknown>;
        accessToken = typeof t.access_token === "string" ? t.access_token : undefined;
      }
      if (!accessToken && typeof raw.access_token === "string") {
        accessToken = raw.access_token;
      }

      if (!accessToken) {
        fastify.log.error("No access token received from Google OAuth");
        reply.code(500).send({ error: "No access token received" });
        return;
      }

      // Get user info from Google
      const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        fastify.log.error(`Google userinfo failed: ${response.status} ${errorText}`);
        reply.code(500).send({ error: "Failed to fetch user info from Google" });
        return;
      }

      const userInfo = (await response.json()) as { email: string };

      // Verify email matches allowed email
      if (userInfo.email !== env.ALLOWED_EMAIL) {
        reply.code(403).send({ error: "Email not authorized" });
        return;
      }

      // Create JWT
      const jwt = fastify.jwt.sign({ email: userInfo.email });

      const postLoginRedirect =
        env.FRONTEND_URL && env.FRONTEND_URL.length > 0
          ? new URL("/", env.FRONTEND_URL).toString()
          : "/";

      // Set cookie and redirect to the SPA origin (see FRONTEND_URL). Using "/" alone would land on the API host (e.g. :3000) instead of Vite (:8080).
      reply
        .setCookie("token", jwt, {
          path: "/",
          httpOnly: true,
          secure: env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        })
        .redirect(postLoginRedirect);
    } catch (err) {
      fastify.log.error({ err }, "OAuth callback error");
      // Don't expose error details to client - log internally only
      reply.code(500).send({ error: "Authentication failed. Please try again." });
    }
  });

  // Get current user
  fastify.get("/api/auth/me", { onRequest: [fastify.authenticate] }, async (request: FastifyRequest) => {
    const payload = request.user as { email?: string };
    return { email: payload.email };
  });

  /** True until the user has at least one asset (wallet) account and one salary period */
  fastify.get("/api/auth/onboarding-status", { onRequest: [fastify.authenticate] }, async () => {
    const [wallet] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.type, "asset"))
      .limit(1);

    const [period] = await db
      .select({ id: salaryPeriods.id })
      .from(salaryPeriods)
      .limit(1);

    const needsOnboarding = !wallet || !period;

    return { needsOnboarding };
  });

  // Logout - protected by CSRF
  fastify.post("/api/auth/logout", { preHandler: fastify.csrfProtection }, async (request: FastifyRequest, reply: FastifyReply) => {
    reply
      .clearCookie("token", { path: "/" })
      .send({ success: true });
  });
}
