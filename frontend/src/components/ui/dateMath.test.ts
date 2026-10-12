import { describe, expect, it } from "vitest";

import {
  addMonths, dayInRange, formatFieldText, monthGrid, parseFieldText, parseTime, stepTime, weekBounds, WEEK_STARTS_ON,
} from "./dateMath";

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

describe("parseFieldText", () => {
  it.each([
    ["en", "12/24/2026 19:00"],
    ["en", "12-24-2026 19:00"],
    ["he", "24/12/2026 19:00"],
    ["he", "24.12.2026, 19:00"],
    ["en", "2026-12-24 19:00"],
    ["he", "2026-12-24T19:00"],
  ] as const)("%s reads %j as 24 Dec 2026 19:00", (lang, text) => {
    expect(parseFieldText(text, lang)).toEqual(local(2026, 12, 24, 19, 0));
  });

  it.each(["", "12/24/2026", "12/24/2026 19", "02/31/2026 10:00", "13/01/2026 10:00", "12/24/2026 24:00", "12/24/26 10:00", "tomorrow"])(
    "rejects %j",
    (text) => {
      expect(parseFieldText(text, "en")).toBeNull();
    },
  );

  it("reads the day first in Hebrew", () => {
    expect(parseFieldText("05/04/2026 08:30", "he")).toEqual(local(2026, 4, 5, 8, 30));
    expect(parseFieldText("05/04/2026 08:30", "en")).toEqual(local(2026, 5, 4, 8, 30));
  });

  it("round-trips with formatFieldText in both languages", () => {
    const date = local(2026, 3, 7, 9, 5);
    expect(formatFieldText(date, "en")).toBe("03/07/2026 09:05");
    expect(formatFieldText(date, "he")).toBe("07/03/2026 09:05");
    expect(parseFieldText(formatFieldText(date, "he"), "he")).toEqual(date);
  });
});

describe("calendar math", () => {
  it("weeks start on Sunday", () => {
    expect(WEEK_STARTS_ON).toBe(0);
    const grid = monthGrid(2026, 9); // October 2026: the 1st is a Thursday
    expect(grid).toHaveLength(42);
    expect(grid[0]).toEqual(local(2026, 9, 27));
    expect(grid[0]!.getDay()).toBe(0);
    expect(weekBounds(local(2026, 10, 15))).toEqual([local(2026, 10, 11), local(2026, 10, 17)]);
  });

  it("clamps the day when moving months", () => {
    expect(addMonths(local(2026, 1, 31), 1)).toEqual(local(2026, 2, 28));
    expect(addMonths(local(2026, 3, 31), -1)).toEqual(local(2026, 2, 28));
  });

  it("disables only days completely outside the range", () => {
    const min = local(2026, 10, 10, 12, 0);
    const max = local(2026, 10, 20, 9, 0);
    expect(dayInRange(local(2026, 10, 9), min, max)).toBe(false);
    expect(dayInRange(local(2026, 10, 10), min, max)).toBe(true);
    expect(dayInRange(local(2026, 10, 20), min, max)).toBe(true);
    expect(dayInRange(local(2026, 10, 21), min, max)).toBe(false);
    expect(dayInRange(local(2030, 1, 1), null, null)).toBe(true);
  });
});

describe("time", () => {
  it.each([
    [[19, 7], 1, [19, 10]],
    [[19, 7], -1, [19, 5]],
    [[19, 10], 1, [19, 15]],
    [[19, 10], -1, [19, 5]],
    [[23, 55], 1, [0, 0]],
    [[0, 0], -1, [23, 55]],
  ] as const)("%j stepped %i → %j", (time, direction, expected) => {
    expect(stepTime([...time], direction)).toEqual(expected);
  });

  it("parses hh:mm", () => {
    expect(parseTime("7:05")).toEqual([7, 5]);
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("7")).toBeNull();
  });
});
