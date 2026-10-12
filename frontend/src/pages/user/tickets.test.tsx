import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as ticketsApi from "../../api/tickets";
import * as navigation from "../../navigation";
import { httpError } from "../../test/factories";
import { makeTicket } from "../../test/factories.events";
import { MyTicketsPage, sortTickets } from "./MyTicketsPage";

vi.mock("../../api/tickets");
vi.mock("../../navigation");
const tickets = vi.mocked(ticketsApi);
const revoke = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  URL.revokeObjectURL = revoke;
  tickets.fetchQrImage.mockResolvedValue("blob:qr-42");
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPage(path = "/tickets") {
  const router = createMemoryRouter([{ path: "*", element: <MyTicketsPage /> }], { initialEntries: [path] });
  const view = render(<RouterProvider router={router} />);
  return { ...view, user: userEvent.setup() };
}

async function card(eventName: string) {
  return within((await screen.findByRole("heading", { name: eventName })).closest("li")!);
}

const event = (name: string, starts: string, ends: string) => ({
  id: 1,
  name,
  location: "Haifa",
  starts_at: starts,
  ends_at: ends,
  status: "ACTIVE" as const,
  cover_image_url: null,
});

describe("sortTickets", () => {
  it("puts upcoming first (soonest on top), then past (latest on top)", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    const list = [
      makeTicket("ENTERED", { id: 1, event: event("Old", "2026-01-01T18:00:00Z", "2026-01-01T22:00:00Z") }),
      makeTicket("VALID", { id: 2, event: event("Later", "2026-12-20T18:00:00Z", "2026-12-20T22:00:00Z") }),
      makeTicket("VALID", { id: 3, event: event("Soon", "2026-11-05T18:00:00Z", "2026-11-05T22:00:00Z") }),
      makeTicket("ENTERED", { id: 4, event: event("Recent", "2026-10-01T18:00:00Z", "2026-10-01T22:00:00Z") }),
    ];

    expect(sortTickets(list, now).map((t) => t.event.name)).toEqual(["Soon", "Later", "Recent", "Old"]);
  });
});

describe("MyTicketsPage", () => {
  it("shows the QR for a valid ticket and frees it on unmount", async () => {
    tickets.myTickets.mockResolvedValue([makeTicket("VALID")]);
    const { unmount } = renderPage();

    const qr = await screen.findByRole("img", { name: "Entry QR code for Summer Concert" });

    expect(qr).toHaveAttribute("src", "blob:qr-42");
    expect(tickets.fetchQrImage).toHaveBeenCalledWith(42);
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:qr-42");
  });

  it("offers face setup until enrolled", async () => {
    tickets.myTickets.mockResolvedValue([makeTicket("VALID")]);
    renderPage();

    expect(await screen.findByRole("link", { name: "Set up face entry" })).toHaveAttribute("href", "/enroll/42");
  });

  it("shows face entry ready when enrolled", async () => {
    tickets.myTickets.mockResolvedValue([makeTicket("VALID", { enrolled: true })]);
    renderPage();

    expect(await screen.findByText("Face entry ready ✓")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Set up face entry" })).not.toBeInTheDocument();
  });

  it("a used ticket shows when it entered, without a QR", async () => {
    tickets.myTickets.mockResolvedValue([makeTicket("ENTERED", { entered_at: "2026-12-01T17:42:00Z" })]);
    renderPage();

    const summer = await card("Summer Concert");
    expect(summer.getByText("Used")).toBeInTheDocument();
    expect(summer.getByText(/Entered at/)).toBeInTheDocument();
    expect(summer.queryByRole("img")).not.toBeInTheDocument();
    expect(tickets.fetchQrImage).not.toHaveBeenCalled();
  });

  it("a pending ticket can complete payment", async () => {
    tickets.myTickets.mockResolvedValue([makeTicket("PENDING_PAYMENT")]);
    tickets.startCheckout.mockResolvedValue("https://pay.example/again");
    const { user } = renderPage();

    await user.click(await screen.findByRole("button", { name: "Complete payment" }));

    await waitFor(() => expect(navigation.redirectTo).toHaveBeenCalledWith("https://pay.example/again"));
  });

  it("a QR download failure can be retried on its own", async () => {
    tickets.myTickets.mockResolvedValue([makeTicket("VALID")]);
    tickets.fetchQrImage.mockRejectedValueOnce(httpError(500)).mockResolvedValue("blob:qr-retry");
    const { user } = renderPage();

    await user.click(await screen.findByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("img")).toHaveAttribute("src", "blob:qr-retry");
  });

  it("empty state links to events", async () => {
    tickets.myTickets.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByRole("link", { name: "Browse events" })).toHaveAttribute("href", "/events");
  });
});

describe("MyTicketsPage: link from Events", () => {
  const scroll = vi.fn();
  beforeEach(() => {
    Element.prototype.scrollIntoView = scroll; // jsdom has no layout
  });

  function twoTickets() {
    tickets.myTickets.mockResolvedValue([
      makeTicket("VALID", { id: 41, event: { ...makeTicket("VALID").event, name: "First Show" } }),
      makeTicket("VALID", { id: 42, event: { ...makeTicket("VALID").event, name: "Second Show" } }),
    ]);
  }

  it("#ticket-42 scrolls to that card, focuses it and highlights it", async () => {
    twoTickets();
    renderPage("/tickets#ticket-42");

    const target = (await screen.findByRole("heading", { name: "Second Show" })).closest("li")!;
    await waitFor(() => expect(target).toHaveFocus());
    expect(target).toHaveAttribute("id", "ticket-42");
    expect(target).toHaveAttribute("data-highlighted", "true");
    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect((await screen.findByRole("heading", { name: "First Show" })).closest("li")).not.toHaveAttribute("data-highlighted");
  });

  it("does nothing without a hash", async () => {
    twoTickets();
    renderPage("/tickets");

    await screen.findByRole("heading", { name: "Second Show" });
    expect(scroll).not.toHaveBeenCalled();
    expect(document.querySelector("[data-highlighted]")).toBeNull();
  });
});
