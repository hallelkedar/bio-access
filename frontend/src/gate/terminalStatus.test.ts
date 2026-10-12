import { describe, expect, it } from "vitest";

import type { GateDecision } from "../api/gate";
import { terminalStatus } from "./terminalStatus";

const approved: GateDecision = { result: "APPROVED", reason: "NONE", ticket_id: 1, user_name: "Dana", similarity: 0.9 };
const denied: GateDecision = { result: "DENIED", reason: "ALREADY_ENTERED", ticket_id: 1, user_name: null, similarity: null };
const idle = { phase: "watching", decision: null, providerDown: false } as const;

describe("terminalStatus", () => {
  it("follows the scanner phase", () => {
    expect(terminalStatus(idle, false)).toBe("watching");
    expect(terminalStatus({ ...idle, phase: "verifying" }, false)).toBe("verifying");
    expect(terminalStatus({ ...idle, phase: "result", decision: approved }, false)).toBe("approved");
    expect(terminalStatus({ ...idle, phase: "result", decision: denied }, false)).toBe("denied");
  });

  it("shows paused for the operator's pause and for a rate-limit pause", () => {
    expect(terminalStatus(idle, true)).toBe("paused");
    expect(terminalStatus({ ...idle, phase: "paused" }, false)).toBe("paused");
    expect(terminalStatus({ ...idle, phase: "result", decision: approved }, true)).toBe("paused");
  });

  it("puts a face service outage above everything else", () => {
    expect(terminalStatus({ ...idle, providerDown: true }, true)).toBe("providerDown");
    expect(terminalStatus({ phase: "result", decision: approved, providerDown: true }, false)).toBe("providerDown");
  });

  it("falls back to watching when a result phase has no decision", () => {
    expect(terminalStatus({ ...idle, phase: "result" }, false)).toBe("watching");
  });
});
