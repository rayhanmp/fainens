import fp from "fastify-plugin";
import oauth2 from "@fastify/oauth2";
import jwt from "@fastify/jwt";
import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

import { env } from "../lib/env";

// Extend FastifyInstance to add authenticate decorator
declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

// Extend jwt payload type
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      email: string;
    };
    user: {
      email: string;
    };
  }
}

// Extend OAuth2 types
declare module "fastify" {
  interface FastifyInstance {
    googleOAuth2: {
      getAccessTokenFromAuthorizationCodeFlow: (request: FastifyRequest) => Promise<{
        access_token: string;
      }>;
    };
  }
}

export default fp(async function (fastify: FastifyInstance) {
  // Register cookie plugin
  await fastify.register(cookie);

  // Register JWT plugin
  await fastify.register(jwt, {
    secret: env.SESSION_SECRET,
    cookie: {
      cookieName: "token",
      signed: false,
    },
  });

  // Register Google OAuth2
  await fastify.register(oauth2, {
    name: "googleOAuth2",
    scope: ["openid", "email", "profile"],
    credentials: {
      client: {
        id: env.GOOGLE_CLIENT_ID,
        secret: env.GOOGLE_CLIENT_SECRET,
      },
      auth: oauth2.GOOGLE_CONFIGURATION,
    },
    startRedirectPath: "/api/auth/google",
    callbackUri: env.GOOGLE_CALLBACK_URL,
  });

  // Auth middleware decorator
  fastify.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const payload = request.user as { email?: string };
      const email = payload?.email;

      if (!email || email !== env.ALLOWED_EMAIL) {
        reply.code(403).send({ error: "Forbidden" });
        return;
      }
    } catch (err) {
      reply.code(401).send({ error: "Unauthorized" });
    }
  });
});
