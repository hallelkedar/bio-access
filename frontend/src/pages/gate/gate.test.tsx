import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as eventsApi from "../../api/events";
import * as gateApi from "../../api/gate";
import { installFakeCamera } from "../../test/fakeCamera";
import { makeEvent } from "../../test/factories.events";
import { GatePage } from "./GatePage";

vi.mock("../../api/events");
vi.mock("../../api/gate");
vi.mock("../../gate/sounds");
const events = vi.mocked(eventsApi);
const gate = vi.mocked(gateApi);

beforeEach(() => {
  vi.resetAllMocks();
  installFakeCamera();
  localStorage.clear();
  events.listEvents.mockResolvedValue([makeEvent(), makeEvent({ id: 8, name: "Winter Gala" })]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderGate() {
  const router = createMemoryRouter([{ path: "*", element: <GatePage scannerOptions={{ holdMs: 200 }} /> }]);
  render(<RouterProvider router={router} />);
  return userEvent.setup();
}

async function start(user: ReturnType<typeof userEvent.setup>, eventName = "Winter Gala", gateName = "north-1") {
  await user.selectOptions(await screen.findByLabelText("Event"), eventName);
  await user.type(screen.getByLabelText("Gate name"), gateName);
  await user.click(screen.getByRole("button", { name: "Start" }));
}

describe("GatePage", () => {
  it("starts the terminal and remembers the setup", async () => {
    const user = renderGate();

    await start(user);

    expect(await screen.findByRole("heading", { name: "Winter Gala" })).toBeInTheDocument();
    expect(screen.getByText("Gate north-1")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("bioaccess.gate")!)).toEqual({ eventId: 8, gateId: "north-1" });
  });

  it("prefills the remembered event and gate", async () => {
    localStorage.setItem("bioaccess.gate", JSON.stringify({ eventId: 8, gateId: "south-2" }));
    renderGate();

    expect(await screen.findByLabelText("Event")).toHaveValue("8");
    expect(screen.getByLabelText("Gate name")).toHaveValue("south-2");
  });

  it("QR fallback (scanner types + Enter) shows the green overlay", async () => {
    gate.verifyQr.mockResolvedValue({
      result: "APPROVED", reason: "NONE", ticket_id: 42, user_name: "Dana Levi", similarity: null,
    });
    const user = renderGate();
    await start(user);

    await user.click(screen.getByRole("button", { name: "QR fallback" }));
    await user.type(screen.getByLabelText("Scan or type the ticket's QR code"), "qr-token-123{Enter}");

    const overlay = await screen.findByRole("alert");
    expect(overlay).toHaveTextContent("Welcome!");
    expect(overlay).toHaveTextContent("Dana Levi");
    expect(gate.verifyQr).toHaveBeenCalledWith(8, "north-1", "qr-token-123");
    expect(screen.getByLabelText("Scan or type the ticket's QR code")).toHaveValue("");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument()); // overlay goes away
  });

  it("QR denial shows the reason in red", async () => {
    gate.verifyQr.mockResolvedValue({
      result: "DENIED", reason: "NOT_RECOGNIZED", ticket_id: null, user_name: null, similarity: null,
    });
    const user = renderGate();
    await start(user);
    await user.click(screen.getByRole("button", { name: "QR fallback" }));

    await user.type(screen.getByLabelText("Scan or type the ticket's QR code"), "bogus{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("Not recognized");
  });

  it("explains when no event is active", async () => {
    events.listEvents.mockResolvedValue([]);
    renderGate();

    expect(await screen.findByText(/No active events/)).toBeInTheDocument();
  });
});

describe("GatePage scanning", () => {
  it("samples the live camera without sending frames while nothing moves", async () => {
    const fake = installFakeCamera();
    const user = renderGate();
    await start(user);

    await new Promise((resolve) => setTimeout(resolve, 800)); // a couple of real scan ticks

    expect(fake.getImageData).toHaveBeenCalled(); // motion check ran on real thumbnails
    expect(gate.verifyFace).not.toHaveBeenCalled(); // static picture: no request
  });
});
