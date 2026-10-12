import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as eventsApi from "../../api/events";
import * as gateApi from "../../api/gate";
import type { GateDecision } from "../../api/gate";
import { installFakeCamera } from "../../test/fakeCamera";
import { makeEvent } from "../../test/factories.events";
import { GatePage } from "./GatePage";

vi.mock("../../api/events");
vi.mock("../../api/gate");
vi.mock("../../gate/sounds");

const APPROVED: GateDecision = { result: "APPROVED", reason: "NONE", ticket_id: 42, user_name: "Dana Levi", similarity: null };
const DENIED: GateDecision = { result: "DENIED", reason: "ALREADY_ENTERED", ticket_id: 42, user_name: null, similarity: null };

beforeEach(() => {
  vi.resetAllMocks();
  installFakeCamera();
  localStorage.clear();
  vi.mocked(eventsApi.listEvents).mockResolvedValue([makeEvent({ id: 8, name: "Winter Gala" })]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function openTerminal() {
  const router = createMemoryRouter([{ path: "*", element: <GatePage scannerOptions={{ holdMs: 200 }} /> }]);
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Gate name"), "north-1");
  await user.click(screen.getByRole("button", { name: "Start" }));
  await screen.findByRole("heading", { name: "Winter Gala" });
  return user;
}

async function scanQr(user: ReturnType<typeof userEvent.setup>, decision: GateDecision) {
  vi.mocked(gateApi.verifyQr).mockResolvedValueOnce(decision);
  await user.type(screen.getByLabelText("Scan or type the ticket's QR code"), "token{Enter}");
  await screen.findByRole("alert");
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
}

describe("gate terminal (control room)", () => {
  it("shows a live clock", async () => {
    await openTerminal();
    expect(screen.getByTestId("gate-clock")).toHaveTextContent(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("status chip follows the scanner: watching, result, paused", async () => {
    const user = await openTerminal();
    expect(screen.getByText("Watching")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "QR fallback" }));
    vi.mocked(gateApi.verifyQr).mockResolvedValueOnce(DENIED);
    await user.type(screen.getByLabelText("Scan or type the ticket's QR code"), "token{Enter}");
    expect(await screen.findByText("Denied")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Watching")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByTestId("scan-frame")).toHaveAttribute("data-phase", "paused");
  });

  it("counts approvals and denials since the page opened", async () => {
    const user = await openTerminal();
    expect(screen.getByTestId("tally-approved")).toHaveTextContent("Approved 0");
    await user.click(screen.getByRole("button", { name: "QR fallback" }));

    await scanQr(user, APPROVED);
    await scanQr(user, APPROVED);
    await scanQr(user, DENIED);

    expect(screen.getByTestId("tally-approved")).toHaveTextContent("Approved 2");
    expect(screen.getByTestId("tally-denied")).toHaveTextContent("Denied 1");
  });

  it("the denial overlay shakes and shows the translated reason", async () => {
    const user = await openTerminal();
    await user.click(screen.getByRole("button", { name: "QR fallback" }));
    vi.mocked(gateApi.verifyQr).mockResolvedValueOnce(DENIED);
    await user.type(screen.getByLabelText("Scan or type the ticket's QR code"), "token{Enter}");

    const overlay = await screen.findByRole("alert");
    expect(overlay).toHaveTextContent("Already entered");
    expect(overlay.querySelector(".animate-shake")).not.toBeNull();
  });

  it("hides the camera while nobody is there and while paused", async () => {
    const user = await openTerminal();
    const standby = await screen.findByTestId("camera-standby");
    expect(standby).toHaveAttribute("data-shown", "true");
    expect(standby).toHaveTextContent("Step up to the camera");

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(standby).toHaveTextContent("Scanning paused");
    expect(standby).toHaveAttribute("data-shown", "true");
  });

  it("shows the camera when someone moves in front of it", async () => {
    const fake = installFakeCamera();
    let frame = 0;
    // Small changes: enough for "someone is there", below the scanner's own motion threshold.
    fake.getImageData.mockImplementation((_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(frame++ % 2 ? 6 : 0) }));
    await openTerminal();

    await waitFor(() => expect(screen.getByTestId("camera-standby")).toHaveAttribute("data-shown", "false"), { timeout: 3000 });
    expect(gateApi.verifyFace).not.toHaveBeenCalled();
  });

  it("keeps the camera shown while a result is on screen", async () => {
    const user = await openTerminal();
    await user.click(screen.getByRole("button", { name: "QR fallback" }));
    vi.mocked(gateApi.verifyQr).mockResolvedValueOnce(APPROVED);
    await user.type(screen.getByLabelText("Scan or type the ticket's QR code"), "token{Enter}");
    await screen.findByRole("alert");
    expect(screen.getByTestId("camera-standby")).toHaveAttribute("data-shown", "false");
  });
});
