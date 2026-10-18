import { describe, expect, it } from "vitest";
import { addMonthsFromAnchor, endOfLocalDay, inclusivePeriodEnd, inclusivePeriodStart, localDate, localDayKey } from "./calendar";

// vitest.config pins TZ to Asia/Jakarta (UTC+7).
describe("calendar", () => {
  it("runs in the app time zone", () => {
    expect(new Date(localDate(2026, 9, 24)).toISOString()).toBe("2026-09-23T17:00:00.000Z");
  });

  it("includes the whole last day of a period stored as local midnight", () => {
    const end = localDate(2026, 9, 24);
    expect(inclusivePeriodEnd(end)).toBe(endOfLocalDay(end));
    expect(inclusivePeriodEnd(end)).toBeGreaterThan(new Date(2026, 8, 24, 12).getTime());
  });

  it("reads legacy UTC-midnight boundaries as the same calendar date", () => {
    const legacyEnd = Date.UTC(2026, 8, 24);
    expect(localDayKey(inclusivePeriodEnd(legacyEnd))).toBe("2026-09-24");
    expect(inclusivePeriodEnd(legacyEnd)).toBe(endOfLocalDay(localDate(2026, 9, 24)));
    expect(inclusivePeriodStart(Date.UTC(2026, 8, 25))).toBe(localDate(2026, 9, 25));
  });

  it("keeps exact end instants as they are", () => {
    const exact = new Date(2026, 8, 24, 18, 30).getTime();
    expect(inclusivePeriodEnd(exact)).toBe(exact);
  });

  it("returns to the anchor day after short months", () => {
    const anchor = localDate(2027, 1, 31);
    expect([1, 2, 3].map((months) => localDayKey(addMonthsFromAnchor(anchor, months)))).toEqual(["2027-02-28", "2027-03-31", "2027-04-30"]);
    expect(localDayKey(addMonthsFromAnchor(localDate(2028, 1, 31), 1))).toBe("2028-02-29");
    expect(localDayKey(addMonthsFromAnchor(anchor, 12))).toBe("2028-01-31");
  });
});
