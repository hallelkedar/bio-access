import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as adminEvents from "../../api/adminEvents";
import * as adminStats from "../../api/adminStats";
import type { AccessEvent, EventStats } from "../../api/adminStats";
import { makeEvent } from "../../test/factories.events";
import { bucketColumns, DashboardPage, occupancyPercent, pickDefaultEvent } from "./DashboardPage";

vi.mock("../../api/adminEvents");
vi.mock("../../api/adminStats");

const feed = vi.hoisted(() => ({
  events: [] as AccessEvent[],
  onEvent: undefined as ((e: AccessEvent) => void) | undefined,
}));
vi.mock("../../hooks/useAdminFeed", () => ({
  useAdminFeed: (options: { onEvent?: (e: AccessEvent) => void }) => {
    feed.onEvent = options.onEvent;
    return { status: "live", events: feed.events };
  },
}));

const STATS: EventStats = {
  event_id: 7,
  entries_per_30_min: [
    { bucket_start: "2026-12-01T17:00:00Z", approved: 3 },
    { bucket_start: "2026-12-01T17:30:00Z", approved: 0 },
    { bucket_start: "2026-12-01T18:00:00Z", approved: 12 },
  ],
  decisions: { approved: 15, denied: 4, denied_by_reason: { NOT_RECOGNIZED: 3, ALREADY_ENTERED: 1 }, approved_by_method: { FACE: 13, QR: 2 } },
  occupancy: { entered: 15, sold: 40, capacity: 100, percent: 15 },
};

const EVENT_FEED: AccessEvent = {
  event_id: 7, gate_id: "north-1", method: "QR", result: "DENIED", reason: "ALREADY_ENTERED",
  ticket_id: 42, user_name: "Dana Levi", similarity: null, timestamp: "2026-12-01T18:05:00Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  feed.events = [];
  vi.mocked(adminEvents.listAllEvents).mockResolvedValue([
    makeEvent({ id: 5, name: "Draft Night", status: "DRAFT" }),
    makeEvent({ id: 7, name: "Summer Concert", status: "ACTIVE" }),
  ]);
  vi.mocked(adminStats.getEventStats).mockResolvedValue(STATS);
});

function renderDashboard(refreshDelayMs = 20) {
  const router = createMemoryRouter([{ path: "*", element: <DashboardPage refreshDelayMs={refreshDelayMs} /> }]);
  render(<RouterProvider router={router} />);
  return userEvent.setup();
}

describe("DashboardPage", () => {
  it("defaults to the active event and shows its numbers", async () => {
    renderDashboard();

    expect(await screen.findByText("Approved scans")).toBeInTheDocument();
    expect(adminStats.getEventStats).toHaveBeenCalledWith(7);
    expect(screen.getByRole("combobox")).toHaveValue("7");
    expect(screen.getByRole("meter", { name: "Occupancy" })).toHaveAttribute("aria-valuenow", "15");
    expect(screen.getByText("15 / 100 inside")).toBeInTheDocument();
    expect(screen.getByText("15%")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Live");
  });

  it("entries chart: tooltip on hover and keyboard focus, table view", async () => {
    const user = renderDashboard();
    const bars = await screen.findAllByRole("button", { name: /entries$/ });
    expect(bars).toHaveLength(3);

    await user.hover(bars[2]!);
    expect(screen.getByRole("tooltip")).toHaveTextContent("12 entries");

    await user.unhover(bars[2]!);
    act(() => bars[0]!.focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent("3 entries");

    await user.click(screen.getByRole("button", { name: "View as table" }));
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(4); // header + 3 buckets
  });

  it("denials by reason: sorted, readable, zeros optional", async () => {
    const user = renderDashboard();

    const items = (await screen.findByText("Denials by reason")).closest("figure")!;
    const rows = within(items).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual(["Not recognized: 3", "Already entered: 1"]);

    await user.click(screen.getByRole("button", { name: "Show all reasons" }));
    expect(within(items).getAllByRole("listitem")).toHaveLength(7);
  });

  it("switching event reloads its stats", async () => {
    const user = renderDashboard();
    await screen.findByText("Approved scans");

    await user.selectOptions(screen.getByRole("combobox"), "5");

    await waitFor(() => expect(adminStats.getEventStats).toHaveBeenLastCalledWith(5));
  });

  it("live events for this event appear and refresh the numbers once", async () => {
    feed.events = [EVENT_FEED, { ...EVENT_FEED, event_id: 99, user_name: "Other Event Guest" }];
    renderDashboard();
    await screen.findByText("Approved scans");
    vi.mocked(adminStats.getEventStats).mockClear();

    const live = screen.getByRole("list", { name: "Live entries" });
    expect(within(live).getByText("Dana Levi")).toBeInTheDocument();
    expect(within(live).getByText("✕ Denied")).toBeInTheDocument();
    expect(within(live).getByText("Already entered")).toBeInTheDocument();
    expect(screen.queryByText("Other Event Guest")).not.toBeInTheDocument();

    act(() => {
      feed.onEvent?.(EVENT_FEED);
      feed.onEvent?.(EVENT_FEED);
      feed.onEvent?.(EVENT_FEED); // a burst
    });
    await waitFor(() => expect(adminStats.getEventStats).toHaveBeenCalledTimes(1));
  });

  it("bucket columns describe local time ranges", () => {
    const columns = bucketColumns(STATS);

    expect(columns).toHaveLength(3);
    expect(columns[2]!.value).toBe(12);
    expect(columns[0]!.description).toMatch(/–/);
  });
});

describe("dashboard data", () => {
  const at = (iso: string) => new Date(iso);

  it("opens on the event that is running now, else the next one", () => {
    const later = makeEvent({ id: 1, status: "ACTIVE", starts_at: "2026-11-02T18:00:00Z", ends_at: "2026-11-02T22:00:00Z" });
    const now = makeEvent({ id: 2, status: "ACTIVE", starts_at: "2026-10-12T08:00:00Z", ends_at: "2026-10-12T20:00:00Z" });
    const soon = makeEvent({ id: 3, status: "ACTIVE", starts_at: "2026-10-20T18:00:00Z", ends_at: "2026-10-20T22:00:00Z" });
    const draft = makeEvent({ id: 4, status: "DRAFT" });

    expect(pickDefaultEvent([later, now, soon, draft], at("2026-10-12T10:00:00Z"))?.id).toBe(2);
    expect(pickDefaultEvent([later, soon, draft], at("2026-10-12T10:00:00Z"))?.id).toBe(3);
    expect(pickDefaultEvent([draft], at("2026-10-12T10:00:00Z"))?.id).toBe(4);
    expect(pickDefaultEvent([])).toBeNull();
  });

  it("occupancy percent never divides by zero", () => {
    expect(occupancyPercent(15, 100, "en")).toBe("15%");
    expect(occupancyPercent(1, 8, "en")).toBe("12.5%");
    expect(occupancyPercent(15, 0, "en")).toBe("—");
  });

  it("empty data: friendly states, no table toggle, no NaN", async () => {
    vi.mocked(adminStats.getEventStats).mockResolvedValue({
      ...STATS,
      entries_per_30_min: [],
      decisions: { approved: 0, denied: 0, denied_by_reason: {}, approved_by_method: {} },
      occupancy: { entered: 0, sold: 0, capacity: 0, percent: 0 },
    });
    renderDashboard();

    expect(await screen.findByText("No entries yet.")).toBeInTheDocument();
    expect(screen.getByText("No denials yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View as table" })).not.toBeInTheDocument();
    expect(screen.getByText("0 inside (no capacity set)")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("formats large numbers", async () => {
    vi.mocked(adminStats.getEventStats).mockResolvedValue({
      ...STATS,
      decisions: { ...STATS.decisions, approved: 12_345 },
      occupancy: { entered: 12_345, sold: 15_000, capacity: 20_000, percent: 61.725 },
    });
    renderDashboard();

    expect(await screen.findByText("12,345 / 20,000 inside")).toBeInTheDocument();
    expect(screen.getAllByText("12,345")).toHaveLength(2); // Inside + Approved tiles
    expect(screen.getByText("61.7%")).toBeInTheDocument();
  });

  it("a very long event name stays inside the event picker", async () => {
    const long = "Spring Music Festival in the Park with a Very Long Name to Test Wrapping and Clipping, Part Two";
    vi.mocked(adminEvents.listAllEvents).mockResolvedValue([makeEvent({ id: 7, name: long, status: "ACTIVE" })]);
    renderDashboard();

    const picker = await screen.findByRole("combobox");
    expect(picker).toHaveTextContent(long);
    expect(picker).toHaveClass("w-full", "min-w-0", "truncate");
  });

  it("the newest scan is listed first; Pause freezes the list and counts what's new", async () => {
    const older = { ...EVENT_FEED, user_name: "Older Guest", timestamp: "2026-12-01T18:00:00Z" };
    const newer = { ...EVENT_FEED, user_name: "Newer Guest", timestamp: "2026-12-01T18:06:00Z" };
    feed.events = [newer, older];
    const user = renderDashboard();
    await screen.findByText("Approved scans");

    const items = () => within(screen.getByRole("list", { name: "Live entries" })).getAllByRole("listitem");
    expect(items()[0]).toHaveTextContent("Newer Guest");

    await user.click(screen.getByRole("button", { name: "Pause updates" }));
    feed.events = [{ ...EVENT_FEED, user_name: "Newest Guest", timestamp: "2026-12-01T18:07:00Z" }, newer, older];
    await user.click(screen.getByRole("button", { name: "Show all reasons" })); // any re-render
    expect(items()[0]).toHaveTextContent("Newer Guest");
    expect(screen.getByText("1 new")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(items()[0]).toHaveTextContent("Newest Guest");
  });
});

