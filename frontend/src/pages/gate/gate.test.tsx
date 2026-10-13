import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as eventsApi from "../../api/events";
import * as gateApi from "../../api/gate";
import { installFakeCamera } from "../../test/fakeCamera";
import { liveEvent } from "../../test/factories.events";
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
  events.listEvents.mockResolvedValue([liveEvent(), liveEvent({ id: 8, name: "Winter Gala" })]);
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

  describe("outside the event's gate hours", () => {
    const soon = (ms: number) => new Date(Date.now() + ms).toISOString();
    async function startOnly(user: ReturnType<typeof userEvent.setup>) { // the only event is preselected
      await user.type(await screen.findByLabelText("Gate name"), "north-1");
      await user.click(screen.getByRole("button", { name: "Start" }));
    }

    it("labels an event that isn't open yet in the picker", async () => {
      events.listEvents.mockResolvedValue([liveEvent({ id: 9, name: "Gala", starts_at: soon(5 * 3_600_000), gate_opens_at: soon(4 * 3_600_000), ends_at: soon(8 * 3_600_000) })]);
      renderGate();

      const option = await screen.findByRole("option", { name: /^Gala · opens / });
      expect(option).toBeInTheDocument();
    });

    it("keeps the camera off before the doors open and sends nothing", async () => {
      const { getUserMedia } = installFakeCamera();
      events.listEvents.mockResolvedValue([liveEvent({ id: 9, name: "Gala", starts_at: soon(5 * 3_600_000), gate_opens_at: soon(4 * 3_600_000), ends_at: soon(8 * 3_600_000) })]);
      const user = renderGate();

      await startOnly(user);

      expect(await screen.findByTestId("gate-closed")).toHaveTextContent(/The gate opens .*the camera turns on by itself/);
      expect(screen.getByRole("status")).toHaveTextContent("Not open yet");
      expect(screen.getByRole("button", { name: "QR fallback" })).toBeDisabled();
      expect(getUserMedia).not.toHaveBeenCalled();
      expect(gate.verifyFace).not.toHaveBeenCalled();
    });

    it("turns the camera on by itself when the doors open", async () => {
      const { getUserMedia } = installFakeCamera();
      events.listEvents.mockResolvedValue([liveEvent({ id: 9, name: "Gala", gate_opens_at: soon(1500) })]);
      const user = renderGate();
      await startOnly(user);
      expect(await screen.findByTestId("gate-closed")).toBeInTheDocument();

      await waitFor(() => expect(getUserMedia).toHaveBeenCalled(), { timeout: 4000 });
      expect(screen.queryByTestId("gate-closed")).not.toBeInTheDocument();
    });

    it("gives the date for a gate that opens weeks from now, without a countdown", async () => {
      events.listEvents.mockResolvedValue([liveEvent({ id: 9, name: "Gala", starts_at: soon(30 * 86_400_000), gate_opens_at: soon(29 * 86_400_000), ends_at: soon(31 * 86_400_000) })]);
      const user = renderGate();
      await startOnly(user);

      const panel = await screen.findByTestId("gate-closed");
      const day = new Date(Date.now() + 29 * 86_400_000).getDate();
      expect(panel).toHaveTextContent(new RegExp(`The gate opens .*\\b${day}\\b`));
      expect(panel).not.toHaveTextContent(/\bin \d/);
    });

    it("says the event has ended and keeps the camera off", async () => {
      const { getUserMedia } = installFakeCamera();
      localStorage.setItem("bioaccess.gate", JSON.stringify({ eventId: 9, gateId: "north-1" }));
      events.listEvents.mockResolvedValue([liveEvent({ id: 9, name: "Gala", ends_at: soon(1500) })]);
      const user = renderGate();
      await user.click(await screen.findByRole("button", { name: "Start" }));

      expect(await screen.findByTestId("gate-closed", {}, { timeout: 4000 })).toHaveTextContent("This event has ended");
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Ended"));
      expect(getUserMedia).toHaveBeenCalledTimes(1); // it was on while the gate was open, and wasn't restarted
    });
  });
});

