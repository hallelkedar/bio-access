import { describe, expect, it } from "vitest";

import { countAxis, labelIndices, niceMax, reasonRows, ticks } from "./chartMath";

describe("chart math", () => {
  it.each([
    [0, 1],
    [3, 5],
    [7, 10],
    [12, 20],
    [23, 25],
    [42, 50],
    [180, 200],
  ])("niceMax(%d) = %d", (value, expected) => {
    expect(niceMax(value)).toBe(expected);
  });

  it("ticks split the axis evenly", () => {
    expect(ticks(20)).toEqual([0, 5, 10, 15, 20]);
  });

  it.each([
    [0, 1, [0, 1]],
    [1, 1, [0, 1]],
    [2.2, 3, [0, 1, 2, 3]], // niceMax 2.5 → a whole top
    [5, 5, [0, 1, 2, 3, 4, 5]],
    [9, 10, [0, 2, 4, 6, 8, 10]],
    [17, 20, [0, 5, 10, 15, 20]],
    [12_345, 20_000, [0, 5000, 10_000, 15_000, 20_000]],
  ])("count axis for %d: top %d, ticks %j (whole, unique)", (value, max, ticks) => {
    const axis = countAxis(value);
    expect(axis).toEqual({ max, ticks });
    expect(axis.ticks.every(Number.isInteger)).toBe(true);
    expect(new Set(axis.ticks).size).toBe(axis.ticks.length);
  });

  it("thins x labels to fit", () => {
    expect([...labelIndices(10, 20)]).toHaveLength(10);
    expect([...labelIndices(16, 8)]).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
    expect(labelIndices(9, 4).has(0)).toBe(true);
  });

  it("reason rows: readable labels, largest first, zeros hidden unless asked", () => {
    const rows = reasonRows({ NOT_RECOGNIZED: 2, ALREADY_ENTERED: 5, LOW_QUALITY: 0 });

    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["Already entered", 5],
      ["Not recognized", 2],
    ]);
    const all = reasonRows({ NOT_RECOGNIZED: 2 }, true);
    expect(all).toHaveLength(7); // every denial reason, never "Approved"
    expect(all.map((r) => r.label)).not.toContain("Approved");
  });
});
