import { describe, expect, it } from "vitest";

import type { MyTicket, TicketStatus } from "../../api/types";
import { makeTicket } from "../../test/factories.events";
import { effectiveState, formatCountdown, isPast, isUsable } from "./ticketState";

const STARTS = "2026-12-01T18:00:00Z"; // makeEvent's dates
const ENDS = "2026-12-01T22:00:00Z";
const at = (iso: string, deltaMs = 0) => new Date(new Date(iso).getTime() + deltaMs);

function ticket(status: TicketStatus, eventStatus: MyTicket["event"]["status"] = "ACTIVE"): MyTicket {
  const base = makeTicket(status);
  return { ...base, event: { ...base.event, status: eventStatus } };
}

describe("effectiveState", () => {
  it.each([
    ["VALID", "ACTIVE", at(STARTS, -1), "UPCOMING"],
    ["VALID", "ACTIVE", at(STARTS), "LIVE_NOW"], // now == starts_at: it has started
    ["VALID", "ACTIVE", at(ENDS, -1), "LIVE_NOW"],
    ["VALID", "ACTIVE", at(ENDS), "ENDED"], // now == ends_at: it is over
    ["VALID", "CLOSED", at(STARTS, -86_400_000), "EVENT_CLOSED"], // closed even with future dates
    ["PENDING_PAYMENT", "ACTIVE", at(STARTS, -1), "AWAITING_PAYMENT"],
    ["PENDING_PAYMENT", "ACTIVE", at(STARTS, 1), "AWAITING_PAYMENT"],
    ["PENDING_PAYMENT", "ACTIVE", at(ENDS), "ENDED"],
    ["PENDING_PAYMENT", "CLOSED", at(STARTS, -1), "EVENT_CLOSED"],
    ["ENTERED", "ACTIVE", at(STARTS, 1), "USED"],
    ["ENTERED", "CLOSED", at(ENDS, 1), "USED"],
    ["CANCELLED", "ACTIVE", at(STARTS, -1), "CANCELLED"],
    ["CANCELLED", "CLOSED", at(ENDS, 1), "CANCELLED"],
  ] as const)("%s ticket, %s event, at %s → %s", (status, eventStatus, now, expected) => {
    expect(effectiveState(ticket(status, eventStatus), now)).toBe(expected);
  });

  it("only upcoming and live tickets are usable", () => {
    expect(["UPCOMING", "LIVE_NOW"].every((s) => isUsable(s as never))).toBe(true);
    expect(["ENDED", "EVENT_CLOSED", "USED", "CANCELLED", "AWAITING_PAYMENT"].some((s) => isUsable(s as never))).toBe(false);
  });

  it("a used ticket goes to Past right away, like ended, closed and cancelled ones", () => {
    for (const state of ["USED", "ENDED", "EVENT_CLOSED", "CANCELLED"] as const) expect(isPast(state)).toBe(true);
    for (const state of ["UPCOMING", "LIVE_NOW", "AWAITING_PAYMENT"] as const) expect(isPast(state)).toBe(false);
  });
});

describe("formatCountdown", () => {
  const minute = 60_000;
  it.each([
    [2 * 1440 * minute + 4 * 60 * minute + 30 * minute, "en", "2d 4h"],
    [2 * 1440 * minute, "en", "2d"],
    [3 * 60 * minute + 12 * minute, "en", "3h 12m"],
    [8 * minute, "en", "8m"],
    [10_000, "en", "1m"],
    [3 * 60 * minute + 12 * minute, "he", "3 שע׳ 12 דק׳"],
  ] as const)("%i ms in %s → %j", (ms, lang, expected) => {
    expect(formatCountdown(ms, lang)).toBe(expected);
  });
});
