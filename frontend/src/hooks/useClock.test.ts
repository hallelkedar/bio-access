import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useClock } from "./useClock";

afterEach(() => {
  vi.useRealTimers();
});

describe("useClock", () => {
  it("ticks every second and stops on unmount", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T18:00:00Z"));
    const { result, unmount } = renderHook(() => useClock());
    expect(result.current.toISOString()).toBe("2026-10-11T18:00:00.000Z");

    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.toISOString()).toBe("2026-10-11T18:00:03.000Z");

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
