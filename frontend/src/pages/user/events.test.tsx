import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as eventsApi from "../../api/events";
import * as ticketsApi from "../../api/tickets";
import * as navigation from "../../navigation";
import { httpError } from "../../test/factories";
import { makeEvent, makeTicket } from "../../test/factories.events";
import { CheckoutCancelPage, CheckoutSuccessPage } from "./CheckoutResultPages";
import { EventsPage } from "./EventsPage";

vi.mock("../../api/events");
vi.mock("../../api/tickets");
vi.mock("../../navigation");
const events = vi.mocked(eventsApi);
const tickets = vi.mocked(ticketsApi);
const redirectTo = vi.mocked(navigation.redirectTo);

beforeEach(() => {
  vi.resetAllMocks();
});

function renderPage(element: React.ReactElement, path = "/") {
  const router = createMemoryRouter([{ path: "*", element }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return userEvent.setup();
}

async function card(name: string) {
  return within((await screen.findByRole("heading", { name })).closest("li")!);
}

describe("EventsPage", () => {
  it("shows events with formatted price and date", async () => {
    events.listEvents.mockResolvedValue([makeEvent()]);
    tickets.myTickets.mockResolvedValue([]);

    renderPage(<EventsPage />);

    const summer = await card("Summer Concert");
    expect(summer.getByText("Tel Aviv")).toBeInTheDocument();
    expect(summer.getByText(/50/)).toHaveTextContent(/₪|ILS/);
    expect(summer.getByText(/2026/)).toBeInTheDocument();
    expect(summer.getByRole("button", { name: "Buy ticket" })).toBeEnabled();
  });

  it.each([
    ["PENDING_PAYMENT", "button", "Complete payment"],
    ["CANCELLED", "button", "Buy ticket"],
    ["VALID", "text", "You have a ticket"],
    ["ENTERED", "text", "Entered"],
  ] as const)("a %s ticket shows %s '%s'", async (status, kind, label) => {
    events.listEvents.mockResolvedValue([makeEvent()]);
    tickets.myTickets.mockResolvedValue([makeTicket(status)]);

    renderPage(<EventsPage />);

    const summer = await card("Summer Concert");
    if (kind === "button") expect(summer.getByRole("button", { name: label })).toBeInTheDocument();
    else expect(summer.getByText(label)).toBeInTheDocument();
  });

  it("buy creates a ticket, opens checkout and redirects", async () => {
    events.listEvents.mockResolvedValue([makeEvent()]);
    tickets.myTickets.mockResolvedValue([]);
    tickets.buyTicket.mockResolvedValue({ id: 99, event_id: 7, status: "PENDING_PAYMENT", purchased_at: "", entered_at: null });
    tickets.startCheckout.mockResolvedValue("https://checkout.stripe.com/c/pay/cs_test_1");
    const user = renderPage(<EventsPage />);

    await user.click((await card("Summer Concert")).getByRole("button", { name: "Buy ticket" }));

    await waitFor(() => expect(redirectTo).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_1"));
    expect(tickets.buyTicket).toHaveBeenCalledWith(7);
    expect(tickets.startCheckout).toHaveBeenCalledWith(99);
  });

  it("complete payment reuses the pending ticket", async () => {
    events.listEvents.mockResolvedValue([makeEvent()]);
    tickets.myTickets.mockResolvedValue([makeTicket("PENDING_PAYMENT")]);
    tickets.startCheckout.mockResolvedValue("https://pay.example/x");
    const user = renderPage(<EventsPage />);

    await user.click((await card("Summer Concert")).getByRole("button", { name: "Complete payment" }));

    await waitFor(() => expect(redirectTo).toHaveBeenCalledWith("https://pay.example/x"));
    expect(tickets.buyTicket).not.toHaveBeenCalled();
    expect(tickets.startCheckout).toHaveBeenCalledWith(42);
  });

  it("sold out shows the error and stays on the page", async () => {
    events.listEvents.mockResolvedValue([makeEvent()]);
    tickets.myTickets.mockResolvedValue([]);
    tickets.buyTicket.mockRejectedValue(httpError(409, "event is sold out"));
    const user = renderPage(<EventsPage />);
    const summer = await card("Summer Concert");

    await user.click(summer.getByRole("button", { name: "Buy ticket" }));

    expect(await summer.findByRole("alert")).toHaveTextContent("Event is sold out");
    expect(summer.getByRole("button", { name: "Buy ticket" })).toBeEnabled();
    expect(redirectTo).not.toHaveBeenCalled();
  });

  it("empty catalog", async () => {
    events.listEvents.mockResolvedValue([]);
    tickets.myTickets.mockResolvedValue([]);

    renderPage(<EventsPage />);

    expect(await screen.findByText(/No upcoming events/)).toBeInTheDocument();
  });

  it("load error offers retry", async () => {
    events.listEvents.mockRejectedValueOnce(httpError(500, "boom")).mockResolvedValue([makeEvent()]);
    tickets.myTickets.mockResolvedValue([]);
    const user = renderPage(<EventsPage />);

    await user.click(await screen.findByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("heading", { name: "Summer Concert" })).toBeInTheDocument();
  });
});

describe("checkout return pages", () => {
  it("success waits until the webhook made the ticket VALID", async () => {
    tickets.myTickets
      .mockResolvedValueOnce([makeTicket("PENDING_PAYMENT")])
      .mockResolvedValueOnce([makeTicket("PENDING_PAYMENT")])
      .mockResolvedValue([makeTicket("VALID")]);

    renderPage(<CheckoutSuccessPage pollMs={5} maxWaitMs={5000} />, "/checkout/success?ticket_id=42");

    expect(screen.getByText("Confirming your payment…")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Payment received!" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My tickets" })).toHaveAttribute("href", "/tickets");
    expect(tickets.myTickets).toHaveBeenCalledTimes(3);
  });

  it("success gives up politely when the webhook is slow", async () => {
    tickets.myTickets.mockResolvedValue([makeTicket("PENDING_PAYMENT")]);

    renderPage(<CheckoutSuccessPage pollMs={5} maxWaitMs={30} refreshAtMs={[]} />, "/checkout/success?ticket_id=42");

    expect(await screen.findByRole("heading", { name: "Payment is being processed" })).toBeInTheDocument();
    expect(tickets.refreshPayment).not.toHaveBeenCalled();
  });

  it("asks the provider directly when the webhook is late", async () => {
    tickets.myTickets.mockResolvedValue([makeTicket("PENDING_PAYMENT")]);
    tickets.refreshPayment.mockResolvedValue("VALID");

    renderPage(<CheckoutSuccessPage pollMs={5} maxWaitMs={5000} refreshAtMs={[20]} />, "/checkout/success?ticket_id=42");

    expect(await screen.findByRole("heading", { name: "Payment received!" })).toBeInTheDocument();
    expect(tickets.refreshPayment).toHaveBeenCalledTimes(1);
    expect(tickets.refreshPayment).toHaveBeenCalledWith(42);
  });

  it("keeps polling when the provider says not paid yet, and check again retries", async () => {
    tickets.myTickets.mockResolvedValue([makeTicket("PENDING_PAYMENT")]);
    tickets.refreshPayment.mockResolvedValueOnce("PENDING_PAYMENT").mockResolvedValueOnce("VALID");
    const user = renderPage(
      <CheckoutSuccessPage pollMs={5} maxWaitMs={60} refreshAtMs={[10]} />,
      "/checkout/success?ticket_id=42",
    );

    await user.click(await screen.findByRole("button", { name: "Check again" }));

    expect(await screen.findByRole("heading", { name: "Payment received!" })).toBeInTheDocument();
    expect(tickets.refreshPayment).toHaveBeenCalledTimes(2);
  });

  it("cancel page can retry checkout", async () => {
    tickets.startCheckout.mockResolvedValue("https://pay.example/again");
    const user = renderPage(<CheckoutCancelPage />, "/checkout/cancel?ticket_id=42");

    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(redirectTo).toHaveBeenCalledWith("https://pay.example/again"));
    expect(tickets.startCheckout).toHaveBeenCalledWith(42);
  });
});
