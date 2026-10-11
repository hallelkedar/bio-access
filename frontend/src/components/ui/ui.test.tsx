import { act, render, renderHook, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { Badge, Button, ButtonLink, Card, CountUp, Reveal } from "./index";

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("usePrefersReducedMotion", () => {
  it("follows the system setting, and is false where matchMedia is missing", () => {
    expect(renderHook(() => usePrefersReducedMotion()).result.current).toBe(false); // jsdom: no matchMedia
    mockReducedMotion(true);
    expect(renderHook(() => usePrefersReducedMotion()).result.current).toBe(true);
  });
});

describe("CountUp", () => {
  it("shows the final value at once under reduced motion", () => {
    mockReducedMotion(true);

    render(<CountUp value={1234} />);

    expect(screen.getAllByText("1,234")).toHaveLength(2); // visual + screen reader
  });

  it("animates to the final value and tells screen readers only the final value", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const { container } = render(<CountUp value={500} durationMs={1000} />);
    const visual = container.querySelector('[aria-hidden="true"]')!;
    expect(container.querySelector(".sr-only")).toHaveTextContent("500");
    expect(visual).toHaveTextContent("0");

    act(() => vi.advanceTimersByTime(500));
    const midway = Number(visual.textContent);
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(500);

    act(() => vi.advanceTimersByTime(600));
    expect(visual).toHaveTextContent("500");
  });

  it("cancels the animation frame on unmount", () => {
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const { unmount } = render(<CountUp value={10} />);

    unmount();

    expect(cancel).toHaveBeenCalled();
  });

  it("uses a custom format", () => {
    mockReducedMotion(true);

    render(<CountUp value={42.5} format={(n) => `${n.toFixed(1)}%`} />);

    expect(screen.getAllByText("42.5%")).toHaveLength(2);
  });
});

describe("Reveal", () => {
  it("shows children right away without IntersectionObserver (jsdom)", () => {
    render(<Reveal><p>Hello</p></Reveal>);

    expect(screen.getByText("Hello").parentElement).toHaveAttribute("data-visible", "true");
  });

  it("reveals when the observer reports it on screen", () => {
    let report: (entries: { isIntersecting: boolean }[]) => void = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof report) {
          report = callback;
        }
        observe() {}
        disconnect() {}
      },
    );

    render(<Reveal><p>Later</p></Reveal>);
    const wrapper = screen.getByText("Later").parentElement!;
    expect(wrapper).toHaveAttribute("data-visible", "false");
    expect(wrapper).toHaveClass("opacity-0");

    act(() => report([{ isIntersecting: true }]));
    expect(wrapper).toHaveAttribute("data-visible", "true");
    expect(wrapper).toHaveClass("animate-fade-up");
  });
});

describe("Button, ButtonLink, Card, Badge", () => {
  it("loading disables the button and marks it busy", () => {
    render(<Button loading>Save</Button>);

    const button = screen.getByRole("button", { name: /Save/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("variants change the look", () => {
    render(<><Button variant="danger">Delete</Button><Button variant="ghost">Cancel</Button></>);

    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass("bg-deny-600");
    expect(screen.getByRole("button", { name: "Cancel" })).not.toHaveClass("bg-deny-600");
  });

  it("ButtonLink is a real link", () => {
    const router = createMemoryRouter([{ path: "*", element: <ButtonLink to="/events">Browse</ButtonLink> }]);
    render(<RouterProvider router={router} />);

    expect(screen.getByRole("link", { name: "Browse" })).toHaveAttribute("href", "/events");
  });

  it("Card and Badge render their content", () => {
    render(<Card interactive><Badge tone="ok">Valid</Badge></Card>);

    expect(screen.getByText("Valid")).toHaveClass("bg-ok-50");
  });
});
