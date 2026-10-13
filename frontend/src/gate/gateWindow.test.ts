import { describe, expect, it } from "vitest";

import { gateWindow } from "./gateWindow";

const event = { gate_opens_at: "2026-10-14T04:00:00Z", ends_at: "2026-10-14T20:00:00Z" };
const at = (iso: string) => gateWindow(event, new Date(iso));

describe("gateWindow", () => {
  it("is closed until the exact opening time, then open", () => {
    expect(at("2026-10-14T03:59:59Z")).toBe("before");
    expect(at("2026-10-14T04:00:00Z")).toBe("open");
  });

  it("closes at the exact end time (the end itself is outside, as on the server)", () => {
    expect(at("2026-10-14T19:59:59Z")).toBe("open");
    expect(at("2026-10-14T20:00:00Z")).toBe("ended");
  });
});
