import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as ticketsApi from "../../api/tickets";
import { ToastProvider } from "../../components/ui";
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
  // The page now depends on the clock: pin "today" before the Dec 2026 test events.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function renderPage(path = "/tickets") {
  const router = createMemoryRouter([{ path: "*", element: <MyTicketsPage /> }], { initialEntries: [path] });
  const view = render(<ToastProvider><RouterProvider router={router} /></ToastProvider>); // as in App.tsx
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

describe("MyTicketsPage: event state", () => {
  const withEvent = (status: Parameters<typeof makeTicket>[0], change: Partial<ReturnType<typeof makeTicket>["event"]>, id = 42) => {
    const base = makeTicket(status, { id });
    return { ...base, event: { ...base.event, ...change } };
  };

  it("a valid ticket of a closed event: no QR, no face setup, filed under Past", async () => {
    tickets.myTickets.mockResolvedValue([withEvent("VALID", { status: "CLOSED" })]);
    const { user } = renderPage();

    await user.click(await screen.findByRole("button", { name: "Past (1)" }));

    const summer = await card("Summer Concert");
    expect(summer.getByText("Event closed by organizer")).toBeInTheDocument();
    expect(summer.queryByRole("img")).not.toBeInTheDocument();
    expect(summer.queryByRole("link", { name: "Set up face entry" })).not.toBeInTheDocument();
    expect(tickets.fetchQrImage).not.toHaveBeenCalled();
    expect(screen.getByText("No upcoming tickets.")).toBeInTheDocument();
    expect(screen.getByText("No upcoming events yet.")).toBeInTheDocument(); // side panel
  });

  it("an unpaid ticket of a closed event says 'Event unavailable' and cannot be paid", async () => {
    tickets.myTickets.mockResolvedValue([withEvent("PENDING_PAYMENT", { status: "CLOSED" })]);
    const { user } = renderPage();

    await user.click(await screen.findByRole("button", { name: "Past (1)" }));

    expect((await card("Summer Concert")).getByText("Event unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Complete payment" })).not.toBeInTheDocument();
  });

  it("Past is collapsed by default and opens on click", async () => {
    tickets.myTickets.mockResolvedValue([withEvent("VALID", { starts_at: "2026-10-01T18:00:00Z", ends_at: "2026-10-01T22:00:00Z" })]);
    const { user } = renderPage();

    const toggle = await screen.findByRole("button", { name: "Past (1)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("heading", { name: "Summer Concert" })).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect((await card("Summer Concert")).getByText("Event ended")).toBeInTheDocument();
  });

  it("a ticket linked from Events opens Past when it lives there", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    tickets.myTickets.mockResolvedValue([withEvent("ENTERED", { starts_at: "2026-10-01T18:00:00Z", ends_at: "2026-10-01T22:00:00Z" })]);
    renderPage("/tickets#ticket-42");

    const target = (await screen.findByRole("heading", { name: "Summer Concert" })).closest("li")!;
    expect(screen.getByRole("button", { name: "Past (1)" })).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(target).toHaveFocus());
  });

  it("flips to 'Happening now' and then 'Event ended' as the clock moves, without a reload", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-12-01T17:59:50Z")); // 10 s before the start
    tickets.myTickets.mockResolvedValue([makeTicket("VALID")]);
    renderPage();
    const summer = await card("Summer Concert");
    expect(summer.getByText("in 1m")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(30_000));
    expect(summer.getByText("Happening now")).toBeInTheDocument();

    act(() => {
      vi.setSystemTime(new Date("2026-12-01T22:00:00Z"));
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByRole("button", { name: "Past (1)" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Entry QR code/ })).not.toBeInTheDocument();
    expect(myTicketsCalls()).toBe(1); // no reload
  });
});

const myTicketsCalls = () => tickets.myTickets.mock.calls.length;

describe("MyTicketsPage: side panel and QR", () => {
  const panel = () => within(screen.getByRole("complementary", { name: "Your next event" }));

  it("shows the next event with a countdown and what is left to do", async () => {
    tickets.myTickets.mockResolvedValue([makeTicket("VALID")]); // starts 1 Dec 18:00Z, now is 12 Oct 10:00Z
    renderPage();
    await card("Summer Concert");

    expect(panel().getByText("Summer Concert")).toBeInTheDocument();
    expect(panel().getByText("in 50d 8h")).toBeInTheDocument();
    expect(panel().getByText(/Paid/)).toBeInTheDocument();
    expect(panel().getByRole("link", { name: "Set up →" })).toHaveAttribute("href", "/enroll/42");
    expect(panel().getByText("How entry works")).toBeInTheDocument();
    expect(panel().queryByRole("heading")).not.toBeInTheDocument(); // the cards own the event headings
  });

  it("says face entry is ready once enrolled", async () => {
    tickets.myTickets.mockResolvedValue([makeTicket("VALID", { enrolled: true })]);
    renderPage();
    await card("Summer Concert");

    expect(panel().getByText(/Face entry · Ready/)).toBeInTheDocument();
    expect(panel().queryByRole("link")).not.toBeInTheDocument();
  });

  it("opens the QR larger and closes it with Esc", async () => {
    tickets.myTickets.mockResolvedValue([makeTicket("VALID")]);
    const { user } = renderPage();
    const show = await screen.findByRole("button", { name: "Show larger" });

    await user.click(show);
    const dialog = screen.getByRole("dialog", { name: "Entry QR · Summer Concert" });
    expect(within(dialog).getByRole("img", { name: "Entry QR code for Summer Concert" })).toHaveAttribute("src", "blob:qr-42");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(show).toHaveFocus();
  });
});

describe("MyTicketsPage: cancel a ticket awaiting payment", () => {
  const notifications = () => screen.getByLabelText("Notifications");

  it("asks first, cancels, says so, and reloads the list", async () => {
    tickets.myTickets
      .mockResolvedValueOnce([makeTicket("PENDING_PAYMENT")])
      .mockResolvedValueOnce([makeTicket("CANCELLED")]);
    tickets.cancelTicket.mockResolvedValue("CANCELLED");
    const { user } = renderPage();

    await user.click(await screen.findByRole("button", { name: "Cancel ticket" }));
    const dialog = screen.getByRole("dialog", { name: "Cancel this ticket?" });
    expect(dialog).toHaveAccessibleDescription(/Summer Concert\W*: your seat will be released/);
    await user.click(within(dialog).getByRole("button", { name: "Yes, cancel it" }));

    await waitFor(() => expect(notifications()).toHaveTextContent("Ticket cancelled. Your seat was released."));
    expect(tickets.cancelTicket).toHaveBeenCalledWith(42);
    expect(tickets.myTickets).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Past (1)" })).toBeInTheDocument(); // no spinner flash needed
  });

  it("'Keep it' changes nothing", async () => {
    tickets.myTickets.mockResolvedValue([makeTicket("PENDING_PAYMENT")]);
    const { user } = renderPage();

    await user.click(await screen.findByRole("button", { name: "Cancel ticket" }));
    await user.click(screen.getByRole("button", { name: "Keep it" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(tickets.cancelTicket).not.toHaveBeenCalled();
  });

  it("an already paid ticket is reported and reloaded as valid", async () => {
    tickets.myTickets
      .mockResolvedValueOnce([makeTicket("PENDING_PAYMENT")])
      .mockResolvedValueOnce([makeTicket("VALID")]);
    tickets.cancelTicket.mockRejectedValue(httpError(409, "ticket already paid"));
    const { user } = renderPage();

    await user.click(await screen.findByRole("button", { name: "Cancel ticket" }));
    await user.click(screen.getByRole("button", { name: "Yes, cancel it" }));

    await waitFor(() => expect(notifications()).toHaveTextContent("This ticket was already paid, so it's valid now."));
    expect(await screen.findByRole("img", { name: "Entry QR code for Summer Concert" })).toBeInTheDocument();
  });

  it("other failures show the server's reason and keep the ticket as it was", async () => {
    tickets.myTickets.mockResolvedValue([makeTicket("PENDING_PAYMENT")]);
    tickets.cancelTicket.mockRejectedValue(httpError(409, "a payment is being processed, try again"));
    const { user } = renderPage();

    await user.click(await screen.findByRole("button", { name: "Cancel ticket" }));
    await user.click(screen.getByRole("button", { name: "Yes, cancel it" }));

    await waitFor(() => expect(notifications()).toHaveTextContent("A payment is being processed, try again"));
    expect(tickets.myTickets).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Complete payment" })).toBeInTheDocument();
  });

  it.each(["VALID", "ENTERED"] as const)("a %s ticket has no cancel button", async (status) => {
    tickets.myTickets.mockResolvedValue([makeTicket(status)]);
    renderPage();

    await card("Summer Concert");
    expect(screen.queryByRole("button", { name: "Cancel ticket" })).not.toBeInTheDocument();
  });
});

