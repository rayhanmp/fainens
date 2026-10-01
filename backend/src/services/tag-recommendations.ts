import { z } from "zod";

type ExistingTag = { id: number; name: string; color: string };
const recommendationSchema = z.object({ tagIds: z.array(z.number().int().positive()).max(20) });

/** Model output can select existing tags, but cannot create or rename them. */
export function parseTagRecommendations(response: string, existingTags: readonly ExistingTag[]) {
  const json = response.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const { tagIds } = recommendationSchema.parse(JSON.parse(json));
  const byId = new Map(existingTags.map(tag => [tag.id, tag]));
  return [...new Set(tagIds)].flatMap(id => {
    const tag = byId.get(id);
    return tag ? [tag] : [];
  }).slice(0, 3);
}
