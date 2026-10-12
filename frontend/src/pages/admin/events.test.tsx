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

  describe("cover drop zone", () => {
    async function openCover() {
      const user = renderAdmin();
      await user.click((await row("Live Show")).getByRole("button", { name: "Edit" }));
      return user;
    }
    const png = (name = "cover.png", size = 3) => new File(["x".repeat(size)], name, { type: "image/png" });

    it("uploads, keeps the editor open, says it is saved and refreshes the list", async () => {
      admin.uploadCover.mockResolvedValue({ ...ACTIVE, cover_image_url: "/media/event-covers/2.png" });
      const user = await openCover();
      const file = png("stage.png", 2048);

      await user.upload(screen.getByLabelText("Choose cover image"), file);
      expect(screen.getByText("stage.png")).toBeInTheDocument();
      expect(screen.getByText(/2 kB/)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Upload cover" }));

      expect(admin.uploadCover).toHaveBeenCalledWith(2, file);
      expect(await screen.findByText("Cover saved ✓")).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "Cover preview" })).toHaveAttribute("src", "/media/event-covers/2.png");
      expect(screen.getByRole("heading", { name: /Live Show/ })).toBeInTheDocument(); // editor still open
      expect(admin.listAllEvents).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("button", { name: "Upload cover" })).toBeDisabled();
    });

    it("accepts a file dropped on the zone", async () => {
      await openCover();
      const zone = screen.getByText("Click to choose an image, or drag it here").closest("label")!;
      const file = png("dropped.png");

      fireEvent.dragEnter(zone, { dataTransfer: { files: [file] } });
      expect(zone).toHaveAttribute("data-dragging", "true");
      fireEvent.drop(zone, { dataTransfer: { files: [file] } });

      expect(zone).not.toHaveAttribute("data-dragging");
      expect(screen.getByText("dropped.png")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Upload cover" })).toBeEnabled();
    });

    it("rejects a wrong type or a too-large file before uploading", async () => {
      await openCover();
      const zone = screen.getByText("Click to choose an image, or drag it here").closest("label")!;

      fireEvent.drop(zone, { dataTransfer: { files: [new File(["%PDF"], "doc.pdf", { type: "application/pdf" })] } });
      expect(screen.getByRole("alert")).toHaveTextContent("Use a real JPEG, PNG or WebP image.");

      fireEvent.drop(zone, { dataTransfer: { files: [png("huge.png", 2 * 1024 * 1024 + 1)] } });
      expect(screen.getByRole("alert")).toHaveTextContent("The image is too large (max 2 MB).");

      expect(screen.getByRole("button", { name: "Upload cover" })).toBeDisabled();
      expect(admin.uploadCover).not.toHaveBeenCalled();
    });

    it("opens the picker from the keyboard (Enter or Space on the zone)", async () => {
      const user = await openCover();
      const zone = screen.getByRole("button", { name: /Click to choose an image, or drag it here/ });
      const picker = vi.spyOn(HTMLInputElement.prototype, "click");

      zone.focus();
      await user.keyboard("{Enter}");
      await user.keyboard(" ");

      expect(picker).toHaveBeenCalledTimes(2);
      expect(screen.getByLabelText("Choose cover image")).toHaveAttribute("tabindex", "-1");
    });

    it("clear removes the chosen file", async () => {
      const user = await openCover();
      await user.upload(screen.getByLabelText("Choose cover image"), png());

      await user.click(screen.getByRole("button", { name: "Clear" }));

      expect(screen.queryByText("cover.png")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Upload cover" })).toBeDisabled();
    });
  });
});
