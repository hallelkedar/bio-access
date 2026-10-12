import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as adminApi from "../../api/admin";
import type { AccessLogRow } from "../../api/admin";
import * as adminEvents from "../../api/adminEvents";
import { ToastProvider } from "../../components/ui";
import { fromLocalInput } from "../../format";
import { httpError, makeUser } from "../../test/factories";
import { makeEvent } from "../../test/factories.events";
import { filtersFromParams, LogsPage, logsCsv, PAGE_SIZE } from "./LogsPage";
import { SettingsPage, trackPercent } from "./SettingsPage";
import { nextSort, sortUsers, UsersPage } from "./UsersPage";

vi.mock("../../api/admin");
vi.mock("../../api/adminEvents");
vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: 99, full_name: "Me Admin", role: "ADMIN" } }),
}));
const admin = vi.mocked(adminApi);

const ROW: AccessLogRow = {
  id: 1, timestamp: "2026-12-01T18:05:00Z", event_id: 7, gate_id: "north-1", method: "FACE",
  result: "APPROVED", reason: "NONE", similarity: 99.12, ticket_id: 42, user_name: "Dana Levi",
};
const ANONYMOUS: AccessLogRow = { ...ROW, id: 2, result: "DENIED", reason: "NOT_RECOGNIZED", similarity: null, ticket_id: null, user_name: null };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(adminEvents.listAllEvents).mockResolvedValue([makeEvent({ id: 7, name: "Summer Concert" })]);
  admin.listLogs.mockResolvedValue({ items: [ROW, ANONYMOUS], total: 2, limit: PAGE_SIZE, offset: 0 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderAt(element: React.ReactElement, path = "/") {
  const router = createMemoryRouter([{ path: "*", element }], { initialEntries: [path] });
  render(<ToastProvider><RouterProvider router={router} /></ToastProvider>); // as in App.tsx
  return { router, user: userEvent.setup() };
}

describe("LogsPage", () => {
  it("shows readable rows; anonymous denials get dashes", async () => {
    renderAt(<LogsPage />);

    const table = await screen.findByRole("table");
    const [, approved, denied] = within(table).getAllByRole("row");
    expect(approved).toHaveTextContent("Summer Concert");
    expect(approved).toHaveTextContent("✓ Approved");
    expect(approved).toHaveTextContent("99.1");
    expect(denied).toHaveTextContent("✕ Denied");
    expect(denied).toHaveTextContent("Not recognized");
    expect(within(denied!).getAllByText("—")).toHaveLength(2); // holder + similarity
  });

  it("filters live in the URL and reach the API; a change returns to page 1", async () => {
    const { router, user } = renderAt(<LogsPage />, "/?page=3");
    await screen.findByRole("table");

    await user.selectOptions(screen.getByLabelText("Result"), "DENIED");

    await waitFor(() => expect(router.state.location.search).toBe("?result=DENIED"));
    expect(admin.listLogs).toHaveBeenLastCalledWith(expect.objectContaining({ result: "DENIED", offset: 0, limit: PAGE_SIZE }));
  });

  it("reads filters from the URL on load (bookmarkable)", async () => {
    renderAt(<LogsPage />, "/?event_id=7&method=QR&gate_id=north-1&page=2");

    await screen.findByRole("table");
    expect(admin.listLogs).toHaveBeenCalledWith(
      expect.objectContaining({ event_id: 7, method: "QR", gate_id: "north-1", offset: PAGE_SIZE }),
    );
    expect(screen.getByLabelText("Method")).toHaveValue("QR");
  });

  it("sends the time range in UTC and blocks from ≥ to", async () => {
    const { user } = renderAt(<LogsPage />);
    await screen.findByRole("table");

    await user.type(screen.getByLabelText("From"), "12/01/2026 20:00{Enter}");
    await waitFor(() =>
      expect(admin.listLogs).toHaveBeenLastCalledWith(expect.objectContaining({ from: fromLocalInput("2026-12-01T20:00") })),
    );
    const calls = admin.listLogs.mock.calls.length;

    await user.type(screen.getByLabelText("To"), "12/01/2026 19:00{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("'From' must be before 'To'.");
    expect(admin.listLogs).toHaveBeenCalledTimes(calls);
  });

  it("quick ranges set From and clear To", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 12, 10, 0));
    const { user, router } = renderAt(<LogsPage />, "/?to=2026-12-01T19:00");
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Last 24h" }));

    await waitFor(() =>
      expect(admin.listLogs).toHaveBeenLastCalledWith(expect.objectContaining({ from: new Date(2026, 9, 11, 10, 0).toISOString(), to: undefined })),
    );
    expect(router.state.location.search).toBe("?from=2026-10-11T10%3A00");
    expect(screen.getByLabelText("From")).toHaveValue("10/11/2026 10:00");

    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByLabelText("From")).toHaveValue("10/12/2026 00:00");
    vi.useRealTimers();
  });

  it("pages through results", async () => {
    admin.listLogs.mockResolvedValue({ items: [ROW], total: 120, limit: PAGE_SIZE, offset: 0 });
    const { router, user } = renderAt(<LogsPage />);

    expect(await screen.findByText("Showing 1–50 of 120")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(router.state.location.search).toBe("?page=2"));
    expect(admin.listLogs).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 }));
  });

  it("active filters are removable chips with a count; Clear shows only when something is set", async () => {
    const { router, user } = renderAt(<LogsPage />, "/?result=DENIED&gate_id=north-1");
    await screen.findByRole("table");

    expect(screen.getByText("2 entries")).toBeInTheDocument();
    const chips = screen.getAllByRole("button", { name: /^Remove filter:/ }).map((b) => b.textContent);
    expect(chips).toEqual(["Result: Denied×", "Gate: north-1×"]);

    await user.click(screen.getByRole("button", { name: "Remove filter: Gate: north-1" }));
    await waitFor(() => expect(router.state.location.search).toBe("?result=DENIED"));
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(router.state.location.search).toBe(""));
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("cells: relative time with the exact time (seconds) on focus, method, result, similarity %", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-01T18:08:00Z")); // 3 minutes after ROW
    renderAt(<LogsPage />);
    const table = await screen.findByRole("table");
    const [, approved] = within(table).getAllByRole("row");

    const time = within(approved!).getByText("3 min. ago");
    expect(time).toHaveAccessibleDescription(/:05:00/); // seconds shown; the hour depends on the time zone
    expect(approved).toHaveTextContent("FACE");
    expect(approved).toHaveTextContent("99.1%");
    expect(within(approved!).getByText("north-1")).toHaveClass("truncate");
  });

  it("loading shows skeleton rows; no results shows an empty state that can clear filters", async () => {
    let resolve: (page: { items: AccessLogRow[]; total: number; limit: number; offset: number }) => void = () => {};
    admin.listLogs.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const { router, user } = renderAt(<LogsPage />, "/?method=QR");

    expect(screen.getByRole("status", { name: "Loading…" })).toBeInTheDocument();
    resolve({ items: [], total: 0, limit: PAGE_SIZE, offset: 0 });

    expect(await screen.findByRole("heading", { name: "No log entries match these filters." })).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Clear filters" }).at(-1)!);
    await waitFor(() => expect(router.state.location.search).toBe(""));
  });

  it("phones get cards instead of the table", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width: 639px"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    renderAt(<LogsPage />);

    await screen.findByText("Dana Levi");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const cards = screen.getAllByRole("listitem");
    expect(cards[0]).toHaveTextContent("Summer Concert");
    expect(cards[0]).toHaveTextContent("✓ Approved");
    vi.unstubAllGlobals();
  });

  it("a row opens a details drawer (click or Enter); Esc closes it and focus returns to the row", async () => {
    const { user } = renderAt(<LogsPage />);
    const table = await screen.findByRole("table");
    const [, approved, denied] = within(table).getAllByRole("row");

    await user.click(approved!);
    const drawer = screen.getByRole("dialog", { name: "Log entry" });
    expect(drawer).toHaveTextContent("Dana Levi");
    expect(drawer).toHaveTextContent("#42");
    expect(drawer).toHaveTextContent("north-1");
    expect(within(drawer).getByRole("button", { name: "Close" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(approved).toHaveFocus();

    denied!.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Log entry" })).toHaveTextContent("Not recognized");
  });

  it("exports the current page as CSV (BOM, headers, escaped values)", async () => {
    let saved: Blob | null = null;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      saved = blob;
      return "blob:logs";
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { user } = renderAt(<LogsPage />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await saved!.arrayBuffer());
    const lines = text.split("\r\n");
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(lines[0]).toBe("\uFEFFTime,Event,Gate,Method,Result,Reason,Holder,Ticket,Similarity");
    expect(lines[1]).toMatch(/^2026-12-01 \d\d:05:00,Summer Concert,north-1,FACE,Approved,,Dana Levi,42,99\.1$/);
    expect(lines[2]).toMatch(/,Denied,Not recognized,,,$/);
  });

  it("logsCsv neutralizes formulas and speaks Hebrew", () => {
    const sneaky: AccessLogRow = { ...ROW, gate_id: "=HYPERLINK(\"http://x\")", user_name: "Levi, Dana" };
    const [header, line] = logsCsv([sneaky], () => "Summer Concert", "he").split("\r\n");

    expect(header).toBe("זמן,אירוע,שער,שיטה,תוצאה,סיבה,בעל הכרטיס,כרטיס,דמיון");
    expect(line).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(line).toContain(`"Levi, Dana"`);
  });

  it("filtersFromParams ignores empty values", () => {
    const { filters, error } = filtersFromParams(new URLSearchParams("result=&page=1"));

    expect(filters.result).toBeUndefined();
    expect(filters.offset).toBe(0);
    expect(error).toBeNull();
  });
});

describe("UsersPage", () => {
  it("searches only after typing pauses", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    admin.listUsers.mockResolvedValue({ items: [makeUser("GATEKEEPER")], total: 1, limit: 50, offset: 0 });
    renderAt(<UsersPage searchDelayMs={300} />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await screen.findByRole("table");
    admin.listUsers.mockClear();

    await user.type(screen.getByLabelText("Search users"), "dana");
    expect(admin.listUsers).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(admin.listUsers).toHaveBeenCalledTimes(1);
    expect(admin.listUsers).toHaveBeenCalledWith(expect.objectContaining({ q: "dana", offset: 0 }));
  });

  it("filters by role and shows the table", async () => {
    admin.listUsers.mockResolvedValue({ items: [makeUser("GATEKEEPER", { phone: null })], total: 1, limit: 50, offset: 0 });
    const { user } = renderAt(<UsersPage searchDelayMs={0} />);
    await screen.findByRole("table");
    expect(screen.getByLabelText("Role of Dana Levi")).toHaveValue("GATEKEEPER");

    await user.selectOptions(screen.getByLabelText("Role"), "GATEKEEPER");

    await waitFor(() => expect(admin.listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ role: "GATEKEEPER" })));
  });
});

describe("SettingsPage", () => {
  beforeEach(() => {
    admin.getSettings.mockResolvedValue({ face_match_threshold: 95, default_face_match_threshold: 95, source: "default" });
  });

  const unsavedBar = () => screen.queryByRole("region", { name: "Unsaved changes" });

  it("slider and number stay in sync; the unsaved bar saves and toasts", async () => {
    admin.updateThreshold.mockResolvedValue({ face_match_threshold: 97.5, default_face_match_threshold: 95, source: "database" });
    const { user } = renderAt(<SettingsPage />);
    const slider = await screen.findByLabelText("Threshold slider");
    expect(screen.getByText("Using the default")).toBeInTheDocument();
    expect(unsavedBar()).toBeNull();

    fireEvent.change(slider, { target: { value: "97.5" } });
    expect(screen.getByLabelText("Threshold value")).toHaveValue(97.5);
    await user.click(within(unsavedBar()!).getByRole("button", { name: "Save" }));

    expect(admin.updateThreshold).toHaveBeenCalledWith(97.5);
    expect(await screen.findByText("Saved — applies to the next scan.")).toBeInTheDocument();
    expect(screen.getByText("Custom value")).toBeInTheDocument();
    expect(unsavedBar()).toBeNull();
  });

  it("discard puts the saved value back without calling the API", async () => {
    const { user } = renderAt(<SettingsPage />);
    const number = await screen.findByLabelText("Threshold value");

    fireEvent.change(number, { target: { value: "90" } });
    await user.click(within(unsavedBar()!).getByRole("button", { name: "Discard" }));

    expect(number).toHaveValue(95);
    expect(unsavedBar()).toBeNull();
    expect(admin.updateThreshold).not.toHaveBeenCalled();
  });

  it("blocks values outside 80-100", async () => {
    renderAt(<SettingsPage />);
    const number = await screen.findByLabelText("Threshold value");

    fireEvent.change(number, { target: { value: "70" } });

    expect(screen.getByRole("alert")).toHaveTextContent("between 80 and 100");
    expect(within(unsavedBar()!).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("reset to default asks first, then saves the .env value", async () => {
    admin.getSettings.mockResolvedValue({ face_match_threshold: 99, default_face_match_threshold: 95, source: "database" });
    admin.updateThreshold.mockResolvedValue({ face_match_threshold: 95, default_face_match_threshold: 95, source: "database" });
    const { user } = renderAt(<SettingsPage />);

    await user.click(await screen.findByRole("button", { name: "Reset to default" }));
    const dialog = screen.getByRole("dialog", { name: "Reset to the default (95%)?" });
    expect(admin.updateThreshold).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Reset" }));

    expect(admin.updateThreshold).toHaveBeenCalledWith(95);
  });

  it("trackPercent places a value on the 80-100 track", () => {
    expect(trackPercent(80)).toBe("0%");
    expect(trackPercent(95)).toBe("75%");
    expect(trackPercent(120)).toBe("100%");
  });
});

describe("UsersPage role changes", () => {
  const staff = makeUser("USER", { id: 12, full_name: "Dana Levi", email: "dana@example.com" });
  const me = makeUser("ADMIN", { id: 99, full_name: "Me Admin", email: "me@example.com" });

  beforeEach(() => {
    admin.listUsers.mockResolvedValue({ items: [staff, me], total: 2, limit: 50, offset: 0 });
  });

  it("promotes after confirmation, updates the row and toasts", async () => {
    admin.changeUserRole.mockResolvedValue({ ...staff, role: "GATEKEEPER" });
    const { user } = renderAt(<UsersPage searchDelayMs={0} />);

    await user.selectOptions(await screen.findByLabelText("Role of Dana Levi"), "GATEKEEPER");
    const dialog = screen.getByRole("dialog", { name: /Make .*Dana Levi.* a Gatekeeper\?/ });
    expect(dialog).toHaveTextContent("open the gate scanner");
    await user.click(within(dialog).getByRole("button", { name: "Change role" }));

    expect(admin.changeUserRole).toHaveBeenCalledWith(12, "GATEKEEPER");
    await waitFor(() => expect(screen.getByLabelText("Role of Dana Levi")).toHaveValue("GATEKEEPER"));
    expect(await screen.findByText(/Dana Levi.* is now: Gatekeeper\./)).toBeInTheDocument();
  });

  it("cancelling the confirmation changes nothing", async () => {
    const { user } = renderAt(<UsersPage searchDelayMs={0} />);

    await user.selectOptions(await screen.findByLabelText("Role of Dana Levi"), "ADMIN");
    await user.click(screen.getByRole("button", { name: "Keep current role" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(admin.changeUserRole).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Role of Dana Levi")).toHaveValue("USER");
  });

  it("your own role can't be changed", async () => {
    renderAt(<UsersPage searchDelayMs={0} />);

    expect(await screen.findByLabelText("Role of Me Admin")).toBeDisabled();
  });

  it("rolls back and shows the server's refusal", async () => {
    admin.changeUserRole.mockRejectedValue(httpError(404, "user not found"));
    const { user } = renderAt(<UsersPage searchDelayMs={0} />);

    await user.selectOptions(await screen.findByLabelText("Role of Dana Levi"), "GATEKEEPER");
    await user.click(screen.getByRole("button", { name: "Change role" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("User not found");
    expect(screen.getByLabelText("Role of Dana Levi")).toHaveValue("USER");
  });
});

describe("UsersPage sorting", () => {
  const users = [
    makeUser("USER", { id: 1, full_name: "bob", email: "z@example.com", created_at: "2026-10-02T10:00:00Z" }),
    makeUser("USER", { id: 2, full_name: "Alice", email: "a@example.com", created_at: "2026-10-03T10:00:00Z" }),
    makeUser("USER", { id: 3, full_name: "Carol", email: "m@example.com", created_at: "2026-10-01T10:00:00Z" }),
  ];
  const names = (list: typeof users) => list.map((u) => u.full_name);

  it("sortUsers orders by name (ignoring case), email or join date; null keeps the server order", () => {
    expect(names(sortUsers(users, null, "en"))).toEqual(["bob", "Alice", "Carol"]);
    expect(names(sortUsers(users, { key: "name", dir: "asc" }, "en"))).toEqual(["Alice", "bob", "Carol"]);
    expect(names(sortUsers(users, { key: "email", dir: "desc" }, "en"))).toEqual(["bob", "Carol", "Alice"]);
    expect(names(sortUsers(users, { key: "joined", dir: "asc" }, "en"))).toEqual(["Carol", "bob", "Alice"]);
  });

  it("nextSort goes ascending, then descending, and restarts on a new column", () => {
    expect(nextSort(null, "name")).toEqual({ key: "name", dir: "asc" });
    expect(nextSort({ key: "name", dir: "asc" }, "name")).toEqual({ key: "name", dir: "desc" });
    expect(nextSort({ key: "name", dir: "desc" }, "name")).toEqual({ key: "name", dir: "asc" });
    expect(nextSort({ key: "name", dir: "desc" }, "email")).toEqual({ key: "email", dir: "asc" });
  });

  it("clicking a header sorts the rows and sets aria-sort", async () => {
    admin.listUsers.mockResolvedValue({ items: users, total: 3, limit: 50, offset: 0 });
    const { user } = renderAt(<UsersPage searchDelayMs={0} />);
    const table = await screen.findByRole("table");
    const nameHeader = within(table).getByRole("columnheader", { name: "Name" });
    expect(nameHeader).toHaveAttribute("aria-sort", "none");

    await user.click(within(nameHeader).getByRole("button"));
    expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
    const firstRow = () => within(table).getAllByRole("row")[1]!;
    expect(firstRow()).toHaveTextContent("Alice");

    await user.click(within(nameHeader).getByRole("button"));
    expect(nameHeader).toHaveAttribute("aria-sort", "descending");
    expect(firstRow()).toHaveTextContent("Carol");
  });

  it("the clear button empties the search box", async () => {
    admin.listUsers.mockResolvedValue({ items: users, total: 3, limit: 50, offset: 0 });
    const { user } = renderAt(<UsersPage searchDelayMs={0} />);
    const search = await screen.findByLabelText("Search users");

    await user.type(search, "bo");
    await user.click(screen.getByRole("button", { name: "Clear search" }));

    expect(search).toHaveValue("");
  });
});
