import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as enrollmentApi from "../../api/enrollment";
import * as ticketsApi from "../../api/tickets";
import { installFakeCamera } from "../../test/fakeCamera";
import { httpError } from "../../test/factories";
import { makeTicket } from "../../test/factories.events";
import { EnrollPage } from "./EnrollPage";

vi.mock("../../api/tickets");
vi.mock("../../api/enrollment");
const tickets = vi.mocked(ticketsApi);
const enrollment = vi.mocked(enrollmentApi);
const createObjectURL = vi.fn(() => "blob:review");
const revokeObjectURL = vi.fn();
let camera: ReturnType<typeof installFakeCamera>;

beforeEach(() => {
  vi.resetAllMocks();
  camera = installFakeCamera();
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  createObjectURL.mockReturnValue("blob:review");
  tickets.myTickets.mockResolvedValue([makeTicket("VALID")]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPage(ticketId = 42) {
  const router = createMemoryRouter([{ path: "/enroll/:ticketId", element: <EnrollPage /> }], {
    initialEntries: [`/enroll/${ticketId}`],
  });
  render(<RouterProvider router={router} />);
  return userEvent.setup();
}

async function consentAndCapture(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  const take = screen.getByRole("button", { name: "Take photo" });
  await waitFor(() => expect(take).toBeEnabled());
  await user.click(take);
  await screen.findByRole("img", { name: "Your photo" });
}

describe("EnrollPage", () => {
  it("doesn't touch the camera until consent is given", async () => {
    const user = renderPage();

    const proceed = await screen.findByRole("button", { name: "Continue" });
    expect(proceed).toBeDisabled();
    expect(camera.getUserMedia).not.toHaveBeenCalled();

    await user.click(screen.getByRole("checkbox"));
    await user.click(proceed);

    await waitFor(() => expect(camera.getUserMedia).toHaveBeenCalled());
  });

  it("capture → review → upload sends the JPEG and finishes", async () => {
    enrollment.enrollFace.mockResolvedValue({ ticket_id: 42, enrolled_at: "2026-11-01T10:00:00Z" });
    const user = renderPage();
    await consentAndCapture(user);

    await user.click(screen.getByRole("button", { name: "Use this photo" }));

    expect(await screen.findByText("Face entry is ready!")).toBeInTheDocument();
    const [ticketId, photo] = enrollment.enrollFace.mock.calls[0]!;
    expect(ticketId).toBe(42);
    expect(photo.type).toBe("image/jpeg");
    expect(camera.track.stop).toHaveBeenCalled(); // camera off once done
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:review"); // review still freed
  });

  it("quality problems show one tip each and return to the camera", async () => {
    enrollment.enrollFace.mockRejectedValue(
      httpError(422, { message: "photo quality is too low", issues: ["TOO_DARK", "BAD_POSE"] }),
    );
    const user = renderPage();
    await consentAndCapture(user);

    await user.click(screen.getByRole("button", { name: "Use this photo" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Find better light");
    expect(alert).toHaveTextContent("Look straight at the camera");
    expect(screen.getByRole("button", { name: "Take photo" })).toBeInTheDocument();
  });

  it("retake goes back to the camera without uploading", async () => {
    const user = renderPage();
    await consentAndCapture(user);

    await user.click(screen.getByRole("button", { name: "Retake" }));

    expect(await screen.findByRole("button", { name: "Take photo" })).toBeInTheDocument();
    expect(enrollment.enrollFace).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:review");
  });

  it("face service outage keeps the user on the camera with a clear message", async () => {
    enrollment.enrollFace.mockRejectedValue(httpError(503, "face service unavailable, try again"));
    const user = renderPage();
    await consentAndCapture(user);

    await user.click(screen.getByRole("button", { name: "Use this photo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("your QR code still works");
  });

  it("a conflict from the server is shown as final", async () => {
    enrollment.enrollFace.mockRejectedValue(httpError(409, "event is not open for enrollment"));
    const user = renderPage();
    await consentAndCapture(user);

    await user.click(screen.getByRole("button", { name: "Use this photo" }));

    expect(await screen.findByText("Event is not open for enrollment")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to my tickets" })).toBeInTheDocument();
  });

  it.each([
    ["already enrolled", [makeTicket("VALID", { enrolled: true })], "already set up"],
    ["not paid", [makeTicket("PENDING_PAYMENT")], "Only paid, unused tickets"],
    ["used", [makeTicket("ENTERED")], "Only paid, unused tickets"],
    ["unknown ticket", [], "Ticket not found."],
  ])("%s tickets can't enroll", async (_, list, message) => {
    tickets.myTickets.mockResolvedValue(list);
    renderPage();

    expect(await screen.findByText(new RegExp(message))).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(camera.getUserMedia).not.toHaveBeenCalled();
  });
});
