import { describe, expect, it } from "vitest";

import { fromLocalInput, parsePriceToCents, toLocalInput } from "./format";

describe("price parsing", () => {
  it.each([
    ["50", 5000],
    ["50.5", 5050],
    ["49.90", 4990],
    ["0", 0],
    [" 12.34 ", 1234],
  ])("%s → %d cents", (text, cents) => {
    expect(parsePriceToCents(text)).toBe(cents);
  });

  it.each(["", "-5", "abc", "1.234", "1,50"])("rejects %j", (text) => {
    expect(parsePriceToCents(text)).toBeNull();
  });
});

describe("datetime-local conversion", () => {
  it("round-trips through the local time zone without drift", () => {
    const iso = "2026-12-01T18:30:00.000Z";

    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
    expect(toLocalInput(iso)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it.each(["", "2026-12-24", "2026-12-2T10:00", "2026-12-24T19", "2026-02-31T10:00", "2026-13-01T10:00", "2026-12-24T24:30", "garbage"])(
    "returns null instead of throwing for %j",
    (value) => {
      expect(fromLocalInput(value)).toBeNull();
    },
  );
});
