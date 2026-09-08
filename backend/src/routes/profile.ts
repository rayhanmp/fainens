import type { FastifyInstance, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db/client";
import { userProfiles } from "../db/schema";
import { parseAgentContextPreferences } from "../services/agent-context";

const MAX_NAME_LENGTH = 120;
const MAX_SHORT_TEXT_LENGTH = 80;
const MAX_COUNTRY_LENGTH = 80;
const MAX_TIMEZONE_LENGTH = 80;

const incomePatterns = ["salary", "freelance", "business", "mixed", "irregular", "other"] as const;
const primaryGoals = ["build_savings", "pay_debt", "control_spending", "plan_purchase", "understand_finances", "other"] as const;
const agentTones = ["warm", "direct", "encouraging"] as const;
const agentVerbosities = ["concise", "balanced", "detailed"] as const;
const agentContextPreferencesSchema = z.object({
  fullName: z.boolean().optional(),
  preferredName: z.boolean().optional(),
  pronouns: z.boolean().optional(),
  age: z.boolean().optional(),
  country: z.boolean().optional(),
  timezone: z.boolean().optional(),
  language: z.boolean().optional(),
  currency: z.boolean().optional(),
  incomePattern: z.boolean().optional(),
  primaryGoal: z.boolean().optional(),
  agentTone: z.boolean().optional(),
  agentVerbosity: z.boolean().optional(),
});
const agentContextResponseSchema = agentContextPreferencesSchema.required();

const profileInputSchema = z.object({
  fullName: z.string().max(MAX_NAME_LENGTH).nullable().optional(),
  preferredName: z.string().max(MAX_SHORT_TEXT_LENGTH).nullable().optional(),
  pronouns: z.string().max(MAX_SHORT_TEXT_LENGTH).nullable().optional(),
  dateOfBirth: z.string().nullable().optional(),
  country: z.string().max(MAX_COUNTRY_LENGTH).nullable().optional(),
  timezone: z.string().min(1).max(MAX_TIMEZONE_LENGTH).optional(),
  language: z.enum(["en", "id"]).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  incomePattern: z.enum(incomePatterns).nullable().optional(),
  primaryGoal: z.enum(primaryGoals).nullable().optional(),
  agentTone: z.enum(agentTones).optional(),
  agentVerbosity: z.enum(agentVerbosities).optional(),
  agentContext: agentContextPreferencesSchema.optional(),
}).passthrough();

const profileResponseSchema = z.object({
  email: z.string().email(),
  fullName: z.string().nullable(),
  preferredName: z.string().nullable(),
  pronouns: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  age: z.number().int().nonnegative().nullable(),
  country: z.string().nullable(),
  timezone: z.string(),
  language: z.enum(["en", "id"]),
  currency: z.string(),
  incomePattern: z.enum(incomePatterns).nullable(),
  primaryGoal: z.enum(primaryGoals).nullable(),
  agentTone: z.enum(agentTones),
  agentVerbosity: z.enum(agentVerbosities),
  agentContext: agentContextResponseSchema,
});

const profileErrorSchema = z.object({ error: z.string() }).passthrough();

type ProfileInput = z.infer<typeof profileInputSchema>;
type ProfileRow = typeof userProfiles.$inferSelect;

function ownerEmail(request: FastifyRequest): string {
  const email = (request.user as { email?: unknown } | undefined)?.email;
  if (typeof email !== "string" || !email.includes("@")) throw new Error("Authenticated user email is unavailable");
  return email;
}

function cleanText(value: unknown, field: string, maxLength: number): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const normalized = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length > maxLength) throw new Error(`${field} must be at most ${maxLength} characters`);
  return normalized || null;
}

function cleanDateOfBirth(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("dateOfBirth must use YYYY-MM-DD format");
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("dateOfBirth is not a valid date");
  if (date.getTime() > Date.now()) throw new Error("dateOfBirth cannot be in the future");
  return value;
}

function cleanTimezone(value: unknown): string {
  const normalized = cleanText(value, "timezone", MAX_TIMEZONE_LENGTH) ?? "Asia/Jakarta";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format();
  } catch {
    throw new Error("timezone must be a valid IANA timezone");
  }
  return normalized;
}

export function calculateAge(dateOfBirth: string | null | undefined, now = new Date()): number | null {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const [year, month, day] = dateOfBirth.split("-").map(Number);
  const age = now.getUTCFullYear() - year - ((now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day)) ? 1 : 0);
  return age >= 0 && age <= 150 ? age : null;
}

function profileResponse(email: string, row?: ProfileRow) {
  return {
    email,
    fullName: row?.fullName ?? null,
    preferredName: row?.preferredName ?? row?.nickname ?? null,
    pronouns: row?.pronouns ?? null,
    dateOfBirth: row?.dateOfBirth ?? null,
    age: calculateAge(row?.dateOfBirth),
    country: row?.country ?? null,
    timezone: row?.timezone ?? "Asia/Jakarta",
    language: (row?.language === "id" ? "id" : "en") as "en" | "id",
    currency: row?.currency ?? "IDR",
    incomePattern: incomePatterns.includes(row?.incomePattern as typeof incomePatterns[number]) ? row?.incomePattern as typeof incomePatterns[number] : null,
    primaryGoal: primaryGoals.includes(row?.primaryGoal as typeof primaryGoals[number]) ? row?.primaryGoal as typeof primaryGoals[number] : null,
    agentTone: agentTones.includes(row?.agentTone as typeof agentTones[number]) ? row?.agentTone as typeof agentTones[number] : "warm" as const,
    agentVerbosity: agentVerbosities.includes(row?.agentVerbosity as typeof agentVerbosities[number]) ? row?.agentVerbosity as typeof agentVerbosities[number] : "concise" as const,
    agentContext: parseAgentContextPreferences(row?.agentContextPreferences),
  };
}

export default async function profileRoutes(fastify: FastifyInstance) {
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/api/profile", {
    schema: { operationId: "getPersonalProfile", tags: ["profile"], response: { 200: profileResponseSchema, 401: profileErrorSchema } },
  }, async (request, reply) => {
    try {
      const email = ownerEmail(request);
      const [row] = await db.select().from(userProfiles).where(eq(userProfiles.ownerEmail, email)).limit(1);
      return profileResponse(email, row);
    } catch (error) {
      return reply.code(401).send({ error: error instanceof Error ? error.message : "Could not load profile" });
    }
  });

  fastify.put("/api/profile", {
    schema: { operationId: "updatePersonalProfile", tags: ["profile"], body: profileInputSchema, response: { 200: profileResponseSchema, 400: profileErrorSchema, 401: profileErrorSchema } },
  }, async (request, reply) => {
    try {
      const email = ownerEmail(request);
      const body = request.body as ProfileInput;
      const [existing] = await db.select().from(userProfiles).where(eq(userProfiles.ownerEmail, email)).limit(1);
      const next = {
        fullName: body.fullName === undefined ? existing?.fullName ?? null : cleanText(body.fullName, "fullName", MAX_NAME_LENGTH),
        preferredName: body.preferredName === undefined ? existing?.preferredName ?? existing?.nickname ?? null : cleanText(body.preferredName, "preferredName", MAX_SHORT_TEXT_LENGTH),
        pronouns: body.pronouns === undefined ? existing?.pronouns ?? null : cleanText(body.pronouns, "pronouns", MAX_SHORT_TEXT_LENGTH),
        dateOfBirth: body.dateOfBirth === undefined ? existing?.dateOfBirth ?? null : cleanDateOfBirth(body.dateOfBirth),
        country: body.country === undefined ? existing?.country ?? null : cleanText(body.country, "country", MAX_COUNTRY_LENGTH),
        timezone: body.timezone === undefined ? existing?.timezone ?? "Asia/Jakarta" : cleanTimezone(body.timezone),
        language: body.language ?? (existing?.language === "id" ? "id" : "en"),
        currency: body.currency ?? existing?.currency ?? "IDR",
        incomePattern: body.incomePattern === undefined ? existing?.incomePattern ?? null : body.incomePattern,
        primaryGoal: body.primaryGoal === undefined ? existing?.primaryGoal ?? null : body.primaryGoal,
        agentTone: body.agentTone ?? (existing?.agentTone === "direct" || existing?.agentTone === "encouraging" ? existing.agentTone : "warm"),
        agentVerbosity: body.agentVerbosity ?? (existing?.agentVerbosity === "balanced" || existing?.agentVerbosity === "detailed" ? existing.agentVerbosity : "concise"),
        agentContextPreferences: JSON.stringify(parseAgentContextPreferences({
          ...parseAgentContextPreferences(existing?.agentContextPreferences),
          ...(body.agentContext ?? {}),
        })),
      };

      if (existing) {
        await db.update(userProfiles).set({ ...next, nickname: next.preferredName, updatedAt: new Date() }).where(eq(userProfiles.ownerEmail, email));
      } else {
        await db.insert(userProfiles).values({ ownerEmail: email, ...next, nickname: next.preferredName });
      }
      const [saved] = await db.select().from(userProfiles).where(eq(userProfiles.ownerEmail, email)).limit(1);
      return profileResponse(email, saved);
    } catch (error) {
      return reply.code(error instanceof Error && error.message.includes("Authenticated") ? 401 : 400).send({ error: error instanceof Error ? error.message : "Could not save profile" });
    }
  });
}
