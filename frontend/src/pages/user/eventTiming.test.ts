import { describe, expect, it } from "vitest";

import { makeEvent } from "../../test/factories.events";
import { eventTiming, matchesFilter } from "./eventTiming";

// Local times, so "today" means the same calendar day in any test time zone.
const local = (day: number, hour: number) => new Date(2026, 11, day, hour);
const event = makeEvent({ starts_at: local(10, 18).toISOString(), ends_at: local(10, 22).toISOString() });

describe("eventTiming", () => {
  it.each([
    ["a month before", local(10, 18).getTime() - 30 * 86_400_000, "LATER"],
    ["six days before", local(4, 18).getTime(), "THIS_WEEK"],
    ["the morning of", local(10, 9).getTime(), "TODAY"],
    ["at the start", local(10, 18).getTime(), "LIVE_NOW"],
    ["at the end", local(10, 22).getTime(), "ENDED"],
  ] as const)("%s → %s", (_, now, expected) => {
    expect(eventTiming(event, new Date(now))).toBe(expected);
  });
});

describe("matchesFilter", () => {
  const free = makeEvent({ ...event, price_cents: 0 });

  it("all keeps everything", () => {
    expect(matchesFilter(event, "all", local(1, 9))).toBe(true);
  });

  it("week keeps events live or starting within 7 days", () => {
    expect(matchesFilter(event, "week", local(4, 18))).toBe(true);
    expect(matchesFilter(event, "week", local(10, 20))).toBe(true);
    expect(matchesFilter(event, "week", local(1, 9))).toBe(false);
  });

  it("free keeps only price 0", () => {
    expect(matchesFilter(free, "free", local(1, 9))).toBe(true);
    expect(matchesFilter(event, "free", local(1, 9))).toBe(false);
  });
});
