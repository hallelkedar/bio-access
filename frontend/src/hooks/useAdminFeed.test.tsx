import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessEvent } from "../api/adminStats";
import { setToken } from "../auth/tokenStore";
import { useAdminFeed } from "./useAdminFeed";

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: ((c: { code: number }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close = vi.fn(() => {
    this.readyState = 3;
  });
  // test helpers
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const EVENT: AccessEvent = {
  event_id: 7, gate_id: "north-1", method: "FACE", result: "APPROVED", reason: "NONE",
  ticket_id: 42, user_name: "Dana Levi", similarity: 99.1, timestamp: "2026-12-01T18:05:00Z",
};

function setup(onEvent = vi.fn()) {
  const hook = renderHook(() =>
    useAdminFeed({ onEvent, createSocket: (url) => new FakeSocket(url) as unknown as WebSocket, pingMs: 1000, maxBackoffMs: 8000 }),
  );
  return { ...hook, onEvent, socket: () => FakeSocket.instances.at(-1)! };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", { OPEN: 1 });
  setToken("admin-jwt");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useAdminFeed", () => {
  it("authenticates with the first message, never in the URL", () => {
    const { result, socket } = setup();

    act(() => socket().open());

    expect(socket().url).toMatch(/^ws:\/\/.+\/ws\/admin$/);
    expect(socket().url).not.toContain("admin-jwt");
    expect(JSON.parse(socket().sent[0]!)).toEqual({ type: "auth", token: "admin-jwt" });
    expect(result.current.status).toBe("connecting");

    act(() => socket().receive({ type: "connected", payload: {} }));
    expect(result.current.status).toBe("live");
  });

  it("collects access events newest first and reports them", () => {
    const { result, socket, onEvent } = setup();
    act(() => {
      socket().open();
      socket().receive({ type: "connected", payload: {} });
      socket().receive({ type: "access_event", payload: EVENT });
      socket().receive({ type: "access_event", payload: { ...EVENT, ticket_id: 43, user_name: "Avi" } });
    });

    expect(result.current.events.map((e) => e.user_name)).toEqual(["Avi", "Dana Levi"]);
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("pings to keep the connection alive", () => {
    const { socket } = setup();
    act(() => {
      socket().open();
      socket().receive({ type: "connected", payload: {} });
    });

    act(() => vi.advanceTimersByTime(2500));

    expect(socket().sent.filter((m) => m.includes("ping"))).toHaveLength(2);
  });

  it("reconnects with growing delays after drops", () => {
    const { result } = setup();
    const first = FakeSocket.instances[0]!;

    act(() => first.drop());
    expect(result.current.status).toBe("reconnecting");
    act(() => vi.advanceTimersByTime(999));
    expect(FakeSocket.instances).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeSocket.instances).toHaveLength(2); // after 1 s

    act(() => FakeSocket.instances[1]!.drop());
    act(() => vi.advanceTimersByTime(1999));
    expect(FakeSocket.instances).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeSocket.instances).toHaveLength(3); // after 2 s
  });

  it("stops for good when the server refuses the token", () => {
    const { result, socket } = setup();

    act(() => socket().drop(4401));
    act(() => vi.advanceTimersByTime(60_000));

    expect(result.current.status).toBe("unauthorized");
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("closes the socket when the page goes away", () => {
    const { unmount, socket } = setup();
    const current = socket();

    unmount();
    act(() => current.drop());
    act(() => vi.advanceTimersByTime(60_000));

    expect(current.close).toHaveBeenCalled();
    expect(FakeSocket.instances).toHaveLength(1); // no reconnect after leaving
  });
});
