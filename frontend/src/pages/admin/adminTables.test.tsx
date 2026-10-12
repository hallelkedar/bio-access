import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as adminApi from "../../api/admin";
import type { AccessLogRow } from "../../api/admin";
import * as adminEvents from "../../api/adminEvents";
import { fromLocalInput } from "../../format";
import { httpError, makeUser } from "../../test/factories";
import { makeEvent } from "../../test/factories.events";
import { filtersFromParams, LogsPage, PAGE_SIZE } from "./LogsPage";
import { SettingsPage } from "./SettingsPage";
import { UsersPage } from "./UsersPage";

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
  render(<RouterProvider router={router} />);
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

  it("slider and number stay in sync; save applies and confirms", async () => {
    admin.updateThreshold.mockResolvedValue({ face_match_threshold: 97.5, default_face_match_threshold: 95, source: "database" });
    const { user } = renderAt(<SettingsPage />);
    const slider = await screen.findByLabelText("Threshold slider");
    expect(screen.getByText(/Using the default/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.change(slider, { target: { value: "97.5" } });
    expect(screen.getByLabelText("Threshold value")).toHaveValue(97.5);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(admin.updateThreshold).toHaveBeenCalledWith(97.5);
    expect(await screen.findByRole("status")).toHaveTextContent("applies to the next scan");
    expect(screen.getByText(/Custom value/)).toBeInTheDocument();
  });

  it("blocks values outside 80-100", async () => {
    renderAt(<SettingsPage />);
    const number = await screen.findByLabelText("Threshold value");

    fireEvent.change(number, { target: { value: "70" } });

    expect(screen.getByRole("alert")).toHaveTextContent("between 80 and 100");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("reset to default saves the .env value", async () => {
    admin.getSettings.mockResolvedValue({ face_match_threshold: 99, default_face_match_threshold: 95, source: "database" });
    admin.updateThreshold.mockResolvedValue({ face_match_threshold: 95, default_face_match_threshold: 95, source: "database" });
    const { user } = renderAt(<SettingsPage />);

    await user.click(await screen.findByRole("button", { name: "Reset to default" }));

    expect(admin.updateThreshold).toHaveBeenCalledWith(95);
  });
});


describe("UsersPage role changes", () => {
  const staff = makeUser("USER", { id: 12, full_name: "Dana Levi", email: "dana@example.com" });
  const me = makeUser("ADMIN", { id: 99, full_name: "Me Admin", email: "me@example.com" });

  beforeEach(() => {
    admin.listUsers.mockResolvedValue({ items: [staff, me], total: 2, limit: 50, offset: 0 });
  });

  it("promotes after confirmation and updates the row", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    admin.changeUserRole.mockResolvedValue({ ...staff, role: "GATEKEEPER" });
    const { user } = renderAt(<UsersPage searchDelayMs={0} />);

    await user.selectOptions(await screen.findByLabelText("Role of Dana Levi"), "GATEKEEPER");

    expect(window.confirm).toHaveBeenCalledWith("Make Dana Levi a Gatekeeper?");
    expect(admin.changeUserRole).toHaveBeenCalledWith(12, "GATEKEEPER");
    await waitFor(() => expect(screen.getByLabelText("Role of Dana Levi")).toHaveValue("GATEKEEPER"));
  });

  it("cancelling the confirmation changes nothing", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { user } = renderAt(<UsersPage searchDelayMs={0} />);

    await user.selectOptions(await screen.findByLabelText("Role of Dana Levi"), "ADMIN");

    expect(admin.changeUserRole).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Role of Dana Levi")).toHaveValue("USER");
  });

  it("your own role can't be changed", async () => {
    renderAt(<UsersPage searchDelayMs={0} />);

    expect(await screen.findByLabelText("Role of Me Admin")).toBeDisabled();
  });

  it("shows the server's refusal", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    admin.changeUserRole.mockRejectedValue(httpError(404, "user not found"));
    const { user } = renderAt(<UsersPage searchDelayMs={0} />);

    await user.selectOptions(await screen.findByLabelText("Role of Dana Levi"), "GATEKEEPER");

    expect(await screen.findByRole("alert")).toHaveTextContent("User not found");
    expect(screen.getByLabelText("Role of Dana Levi")).toHaveValue("USER");
  });
});
