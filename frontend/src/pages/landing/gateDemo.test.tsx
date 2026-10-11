import { act, renderHook, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../../api/auth";
import { setToken } from "../../auth/tokenStore";
import { makeUser } from "../../test/factories";
import { renderApp } from "../../test/renderApp";
import { DEMO_SCRIPT, useGateDemo } from "./useGateDemo";

vi.mock("../../api/auth");

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

beforeEach(() => {
  vi.mocked(authApi.fetchMe).mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useGateDemo", () => {
  it("plays every phase of the script in order, then loops", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useGateDemo({ running: true }));

    const seen = DEMO_SCRIPT.map(({ ms }) => {
      const phase = result.current;
      act(() => vi.advanceTimersByTime(ms));
      return phase;
    });

    expect(seen).toEqual(DEMO_SCRIPT.map((s) => s.phase));
    expect(seen).toContain("approved");
    expect(seen).toContain("denied");
    expect(result.current).toBe("watching"); // back at the start
  });

  it("keeps a single timer and clears it on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useGateDemo({ running: true }));
    act(() => vi.advanceTimersByTime(DEMO_SCRIPT[0]!.ms));
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("holds still while not running (offscreen)", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useGateDemo({ running: false }));
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe("watching");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows a fixed approved state with reduced motion, without timers", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useGateDemo({ running: true, still: true }));
    expect(result.current).toBe("approved");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("<GateDemo/> on the landing page", () => {
  it("shows the simulation to guests, without the real-gate button", async () => {
    renderApp("/");
    const demo = within(await screen.findByTestId("gate-demo"));
    expect(demo.getByText("Simulation")).toBeInTheDocument();
    expect(demo.getByText("Waiting for someone to step in")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Try the real gate" })).not.toBeInTheDocument();
  });

  it("offers the real gate to a gatekeeper", async () => {
    setToken("jwt");
    vi.mocked(authApi.fetchMe).mockResolvedValue(makeUser("GATEKEEPER"));
    renderApp("/");
    expect(await screen.findByRole("link", { name: "Try the real gate" })).toHaveAttribute("href", "/gate");
  });

  it("does not offer it to an admin (the gate route is gatekeeper-only)", async () => {
    setToken("jwt");
    vi.mocked(authApi.fetchMe).mockResolvedValue(makeUser("ADMIN"));
    renderApp("/");
    await screen.findByRole("link", { name: "Open the dashboard" });
    expect(screen.queryByRole("link", { name: "Try the real gate" })).not.toBeInTheDocument();
  });

  it("shows a static approved result with reduced motion", async () => {
    mockReducedMotion(true);
    renderApp("/");
    const card = await screen.findByTestId("gate-demo");
    expect(card).toHaveAttribute("data-phase", "approved");
    expect(within(card).getByText("Welcome!")).toBeInTheDocument();
    expect(within(card).getByText("Noa Cohen")).toBeInTheDocument();
  });
});
