import { describe, expect, it } from "vitest";
import { parseTagRecommendations } from "./tag-recommendations";

const tags = [1, 2, 3, 4].map(id => ({ id, name: `Tag ${id}`, color: "#64748B" }));

describe("tag recommendations", () => {
  it("preserves ranked existing tags and removes duplicates and unknown IDs", () => {
    expect(parseTagRecommendations('{"tagIds":[2,999,2,1]}', tags)).toEqual([tags[1], tags[0]]);
  });
  it("limits recommendations to three without changing the existing tags", () => {
    expect(parseTagRecommendations('{"tagIds":[4,3,2,1]}', tags)).toEqual([tags[3], tags[2], tags[1]]);
    expect(tags.map(tag => tag.id)).toEqual([1, 2, 3, 4]);
  });
  it("allows an empty result when no tag fits", () => {
    expect(parseTagRecommendations('{"tagIds":[]}', tags)).toEqual([]);
    expect(parseTagRecommendations('{"tagIds":[999]}', tags)).toEqual([]);
  });
  it("accepts a JSON code fence", () => {
    expect(parseTagRecommendations('```json\n{"tagIds":[1]}\n```', tags)).toEqual([tags[0]]);
  });
  it.each(['not JSON', '{"tags":["New tag"]}', '{"tagIds":["1"]}', '{"tagIds":[0]}', '{"tagIds":[1.5]}'])("rejects malformed output: %s", response => {
    expect(() => parseTagRecommendations(response, tags)).toThrow();
  });
});
