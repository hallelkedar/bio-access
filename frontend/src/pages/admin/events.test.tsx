import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as adminApi from "../../api/adminEvents";
import { fromLocalInput } from "../../format";
import { httpError } from "../../test/factories";
import { makeEvent } from "../../test/factories.events";
import { AdminLayout } from "./AdminLayout";
import { EventsAdminPage } from "./EventsAdminPage";

vi.mock("../../api/adminEvents");
const admin = vi.mocked(adminApi);

const DRAFT = makeEvent({ id: 1, name: "Draft Party", status: "DRAFT" });
const ACTIVE = makeEvent({ id: 2, name: "Live Show", status: "ACTIVE" });
const CLOSED = makeEvent({ id: 3, name: "Old Gig", status: "CLOSED" });

beforeEach(() => {
  vi.resetAllMocks();
  admin.listAllEvents.mockResolvedValue([DRAFT, ACTIVE, CLOSED]);
  URL.createObjectURL = vi.fn(() => "blob:cover-preview");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderAdmin(path = "/admin/events") {
  const router = createMemoryRouter(
    [{ path: "/admin", element: <AdminLayout />, children: [{ path: "events", element: <EventsAdminPage /> }] }],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return userEvent.setup();
}

async function row(name: string) {
  return within((await screen.findByText(name)).closest("tr")!);
}

describe("EventsAdminPage", () => {
  it("lists every status with the right actions", async () => {
    renderAdmin();

    const draft = await row("Draft Party");
    expect(draft.getByText("DRAFT")).toBeInTheDocument();
    expect(draft.getByRole("button", { name: "Activate" })).toBeInTheDocument();
    expect(draft.getByRole("button", { name: "Delete" })).toBeInTheDocument();

    const live = await row("Live Show");
    expect(live.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(live.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();

    const old = await row("Old Gig");
    expect(old.queryByRole("button", { name: /Activate|Close|Delete/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Events" })).toHaveClass("bg-slate-900"); // admin nav highlights
  });

  it("creates an event with cents and UTC times", async () => {
    admin.createEvent.mockResolvedValue(makeEvent({ id: 9 }));
    const user = renderAdmin();
    await user.click(await screen.findByRole("button", { name: "New event" }));

    await user.type(screen.getByLabelText("Name"), "Winter Gala");
    await user.type(screen.getByLabelText("Location"), "Jerusalem");
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-12-24T19:00" } });
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2026-12-24T23:30" } });
    await user.type(screen.getByLabelText("Capacity"), "250");
    await user.type(screen.getByLabelText("Price"), "49.90");
    await user.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() =>
      expect(admin.createEvent).toHaveBeenCalledWith({
        name: "Winter Gala",
        location: "Jerusalem",
        starts_at: fromLocalInput("2026-12-24T19:00"),
        ends_at: fromLocalInput("2026-12-24T23:30"),
        capacity: 250,
        price_cents: 4990,
        currency: "ILS",
      }),
    );
    expect(admin.listAllEvents).toHaveBeenCalledTimes(2); // list refreshed
  });

  it("checks the price before sending", async () => {
    const user = renderAdmin();
    await user.click(await screen.findByRole("button", { name: "New event" }));
    await user.type(screen.getByLabelText("Price"), "abc");
    await user.type(screen.getByLabelText("Capacity"), "10");

    await user.click(screen.getByRole("button", { name: "Create event" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Price must be a number");
    expect(admin.createEvent).not.toHaveBeenCalled();
  });

  it("edit prefills the form and saves changes", async () => {
    admin.updateEvent.mockResolvedValue(DRAFT);
    const user = renderAdmin();
    await user.click((await row("Draft Party")).getByRole("button", { name: "Edit" }));

    expect(screen.getByLabelText("Name")).toHaveValue("Draft Party");
    expect(screen.getByLabelText("Price")).toHaveValue("50.00");
    await user.clear(screen.getByLabelText("Capacity"));
    await user.type(screen.getByLabelText("Capacity"), "120");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(admin.updateEvent).toHaveBeenCalledWith(1, expect.objectContaining({ capacity: 120 })));
  });

  it("activate sends ACTIVE and explains a face service outage", async () => {
    admin.updateEvent.mockRejectedValue(httpError(503, "face service unavailable, try again"));
    const user = renderAdmin();
    const draft = await row("Draft Party");

    await user.click(draft.getByRole("button", { name: "Activate" }));

    expect(admin.updateEvent).toHaveBeenCalledWith(1, { status: "ACTIVE" });
    expect(await draft.findByRole("alert")).toHaveTextContent("face service is unavailable");
  });

  it("delete asks first", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    admin.deleteEvent.mockResolvedValue();
    const user = renderAdmin();
    const draft = await row("Draft Party");

    await user.click(draft.getByRole("button", { name: "Delete" }));
    expect(admin.deleteEvent).not.toHaveBeenCalled();

    await user.click(draft.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(admin.deleteEvent).toHaveBeenCalledWith(1));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Draft Party"));
  });

  it("uploads a cover and explains a rejected file", async () => {
    admin.uploadCover.mockRejectedValueOnce(httpError(415, "only JPEG, PNG, WEBP images are allowed"));
    const user = renderAdmin();
    await user.click((await row("Live Show")).getByRole("button", { name: "Edit" }));
    const file = new File(["png"], "cover.png", { type: "image/png" });

    await user.upload(screen.getByLabelText("Choose cover image"), file);
    expect(screen.getByRole("img", { name: "Cover preview" })).toHaveAttribute("src", "blob:cover-preview");
    await user.click(screen.getByRole("button", { name: "Upload cover" }));

    expect(admin.uploadCover).toHaveBeenCalledWith(2, file);
    expect(await screen.findByRole("alert")).toHaveTextContent("Use a real JPEG, PNG or WebP image.");
  });
});
