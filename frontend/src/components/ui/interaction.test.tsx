import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LANG_STORAGE_KEY, LanguageProvider } from "../../i18n/LanguageProvider";
import { Button, ConfirmDialog, EmptyState, RouteTransition, SkeletonTable, SkeletonText, SkeletonTiles, ToastProvider, Tooltip, useToast } from "./index";

const wrap = (ui: ReactNode) => render(<LanguageProvider>{ui}</LanguageProvider>);

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

function ToastButtons() {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast.success("Saved")}>ok</button>
      <button onClick={() => toast.error("Failed")}>bad</button>
    </>
  );
}

describe("Toast", () => {
  it("appears in the live region and dismisses itself", () => {
    vi.useFakeTimers();
    wrap(<ToastProvider durationMs={4000}><ToastButtons /></ToastProvider>);
    const region = screen.getByLabelText("Notifications");
    expect(region).toHaveAttribute("aria-live", "polite");

    fireEvent.click(screen.getByText("ok"));
    expect(region).toHaveTextContent("Saved");

    act(() => vi.advanceTimersByTime(3999));
    expect(region).toHaveTextContent("Saved");
    act(() => vi.advanceTimersByTime(1));
    expect(region).not.toHaveTextContent("Saved");
  });

  it("stacks toasts, pauses on hover, and closes with the dismiss button", () => {
    vi.useFakeTimers();
    wrap(<ToastProvider durationMs={4000}><ToastButtons /></ToastProvider>);
    fireEvent.click(screen.getByText("ok"));
    fireEvent.click(screen.getByText("bad"));
    const saved = screen.getByText("Saved").closest("[data-kind]")!;
    expect(saved).toHaveAttribute("data-kind", "success");
    expect(screen.getByText("Failed").closest("[data-kind]")).toHaveAttribute("data-kind", "error");

    act(() => vi.advanceTimersByTime(1000));
    fireEvent.mouseEnter(saved);
    act(() => vi.advanceTimersByTime(10_000)); // paused: stays; the other one expires
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();

    fireEvent.mouseLeave(saved);
    act(() => vi.advanceTimersByTime(2999)); // 3000 ms were left when the pause began
    expect(screen.getByText("Saved")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("ok"));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("refuses to work outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => wrap(<ToastButtons />)).toThrow(/ToastProvider/);
  });
});

function DeleteFlow({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Delete event</button>
      <ConfirmDialog open={open} tone="danger" title="Delete this event?" message="This cannot be undone." confirmLabel="Delete"
        onConfirm={() => { onConfirm(); setOpen(false); }} onCancel={() => { onCancel(); setOpen(false); }} />
    </>
  );
}

describe("ConfirmDialog", () => {
  it("opens with focus on Cancel, traps Tab, and returns focus on Esc", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    wrap(<DeleteFlow onConfirm={onConfirm} onCancel={onCancel} />);
    const opener = screen.getByRole("button", { name: "Delete event" });

    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Delete this event?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("This cannot be undone.");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Delete" });
    expect(cancel).toHaveFocus();

    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab(); // wraps around instead of leaving the dialog
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("calls onConfirm from the confirm button, and cancels on a backdrop click", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    wrap(<DeleteFlow onConfirm={onConfirm} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: "Delete event" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete event" }));
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(onCancel).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Delete event" }));
    fireEvent.mouseDown(screen.getByRole("dialog")); // a click inside the panel is not a backdrop click
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("blocks closing while busy and translates the default labels", () => {
    localStorage.setItem(LANG_STORAGE_KEY, "he");
    const onCancel = vi.fn();
    wrap(<ConfirmDialog open busy title="למחוק?" onConfirm={() => {}} onCancel={onCancel} />);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "ביטול" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /אישור/ })).toHaveAttribute("aria-busy", "true");
  });
});

describe("Skeleton", () => {
  it("renders placeholders announced once as loading", () => {
    wrap(
      <>
        <SkeletonText lines={2} />
        <SkeletonTable rows={3} columns={5} />
        <SkeletonTiles count={4} />
      </>,
    );

    const statuses = screen.getAllByRole("status", { name: "Loading…" });
    expect(statuses).toHaveLength(3);
    statuses.forEach((s) => expect(s).toHaveAttribute("aria-busy", "true"));
    expect(screen.getAllByTestId("skeleton-row")).toHaveLength(3);
    expect(statuses[0]!.querySelectorAll("[aria-hidden]")).toHaveLength(2);
  });
});

describe("EmptyState", () => {
  it("shows title, hint and action", () => {
    wrap(<EmptyState title="No tickets yet" hint="Buy one from Events." action={<Button>Browse events</Button>} />);

    expect(screen.getByRole("heading", { name: "No tickets yet" })).toBeInTheDocument();
    expect(screen.getByText("Buy one from Events.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Browse events" })).toBeInTheDocument();
  });
});

describe("Tooltip", () => {
  it("describes its trigger, opens on hover and focus, and closes on Esc", async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    wrap(<Tooltip content="Copy the link"><button onFocus={onFocus}>Copy</button></Tooltip>);
    const trigger = screen.getByRole("button", { name: "Copy" });
    const tip = screen.getByRole("tooltip", { hidden: true });

    expect(trigger).toHaveAccessibleDescription("Copy the link");
    expect(tip).toHaveAttribute("data-open", "false");

    await user.hover(trigger);
    expect(tip).toHaveAttribute("data-open", "true");
    await user.unhover(trigger);
    expect(tip).toHaveAttribute("data-open", "false");

    await user.tab();
    expect(onFocus).toHaveBeenCalled(); // the child's own handler still runs
    expect(tip).toHaveAttribute("data-open", "true");
    await user.keyboard("{Escape}");
    expect(tip).toHaveAttribute("data-open", "false");
  });
});

describe("Button", () => {
  it("is disabled and busy while loading", () => {
    wrap(<Button loading>Save</Button>);

    const button = screen.getByRole("button", { name: /Save/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});

describe("RouteTransition", () => {
  it("replays the animation on each route change", async () => {
    const user = userEvent.setup();
    // One shared layout, as in App.tsx: only the key can make the wrapper new.
    const router = createMemoryRouter([{
      element: <RouteTransition><Outlet /></RouteTransition>,
      children: [
        { path: "/", element: <Link to="/next">next</Link> },
        { path: "/next", element: <p>second page</p> },
      ],
    }]);
    render(<RouterProvider router={router} />);
    const first = screen.getByTestId("route-transition");
    expect(first).toHaveClass("motion-safe:animate-route-in");

    await user.click(screen.getByText("next"));

    expect(screen.getByText("second page")).toBeInTheDocument();
    expect(screen.getByTestId("route-transition")).not.toBe(first);
  });
});
