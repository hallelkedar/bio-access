import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as enrollmentApi from "../../api/enrollment";
import * as ticketsApi from "../../api/tickets";
import { resetFaceDetector } from "../../enroll/photoChecks";
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

/** A frame the photo checks accept: mid-gray checkerboard (bright enough, sharp). */
function goodFrame(_x: number, _y: number, w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 190 : 70;
      data.set([v, v, v, 255], (y * w + x) * 4);
    }
  }
  return { data, width: w, height: h } as ImageData;
}

beforeEach(() => {
  vi.resetAllMocks();
  camera = installFakeCamera();
  // The fake camera's frames are all black; the photo checks would (rightly) object.
  camera.getImageData.mockImplementation(goodFrame);
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  createObjectURL.mockReturnValue("blob:review");
  tickets.myTickets.mockResolvedValue([makeTicket("VALID")]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPage(ticketId = 42, search = "") {
  const router = createMemoryRouter([{ path: "/enroll/:ticketId", element: <EnrollPage /> }], {
    initialEntries: [`/enroll/${ticketId}${search}`],
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

describe("EnrollPage: photo checks in the browser", () => {
  /** A checkerboard of two gray levels: `light`/`dark` set brightness and contrast. */
  const frame = (dark: number, light: number) => (_x: number, _y: number, w: number, h: number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? light : dark;
        data.set([v, v, v, 255], (y * w + x) * 4);
      }
    }
    return { data, width: w, height: h } as ImageData;
  };
  const row = (name: string) => screen.getByText(name).closest("li")!;

  afterEach(() => {
    delete (globalThis as { FaceDetector?: unknown }).FaceDetector;
    resetFaceDetector();
  });

  it("shows the live verdict, then a checklist with the face row not checked (no FaceDetector)", async () => {
    const user = renderPage();
    await user.click(await screen.findByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // No face detector here, so it doesn't claim more than it checked.
    expect(await screen.findByRole("status", {}, { timeout: 2000 })).toHaveTextContent("Light and focus look good ✓");
    await user.click(screen.getByRole("button", { name: "Take photo" }));
    await screen.findByRole("img", { name: "Your photo" });

    expect(row("Lighting")).toHaveAttribute("data-mark", "✓");
    expect(row("Sharpness")).toHaveAttribute("data-mark", "✓");
    expect(row("Size")).toHaveAttribute("data-mark", "✓");
    expect(row("Face")).toHaveAttribute("data-mark", "–");
    expect(row("Face")).toHaveTextContent("Not checked in this browser");
    expect(screen.getByRole("button", { name: "Use this photo" })).toBeEnabled();
  });

  it("a photo the server would reject can be taken, but not used: Retake instead", async () => {
    camera.getImageData.mockImplementation(frame(0, 0)); // lens covered
    const user = renderPage();
    await user.click(await screen.findByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    const take = screen.getByRole("button", { name: "Take photo" });
    await waitFor(() => expect(take).toBeEnabled());

    await user.click(take);
    const dialog = screen.getByRole("dialog", { name: "This photo may be rejected. Take it anyway?" });
    expect(dialog).toHaveTextContent("It's too dark");
    await user.click(screen.getByRole("button", { name: "Take it anyway" }));
    await screen.findByRole("img", { name: "Your photo" });

    expect(row("Lighting")).toHaveAttribute("data-mark", "✕");
    expect(row("Sharpness")).toHaveAttribute("data-mark", "✕");
    expect(screen.getByRole("alert")).toHaveTextContent("This photo would be rejected.");
    expect(screen.getByRole("button", { name: "Use this photo" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Retake" }));
    expect(screen.getByRole("button", { name: "Take photo" })).toBeInTheDocument();
    expect(enrollment.enrollFace).not.toHaveBeenCalled();
  });

  it("a soft warning only asks first, then the photo can be used", async () => {
    camera.getImageData.mockImplementation(frame(30, 90)); // mean 60: dim, not rejected
    enrollment.enrollFace.mockResolvedValue(undefined as never);
    const user = renderPage();
    await user.click(await screen.findByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    const take = screen.getByRole("button", { name: "Take photo" });
    await waitFor(() => expect(take).toBeEnabled());

    await user.click(take);
    await user.click(screen.getByRole("button", { name: "Keep adjusting" })); // changes nothing
    expect(screen.queryByRole("img", { name: "Your photo" })).not.toBeInTheDocument();
    await user.click(take);
    await user.click(screen.getByRole("button", { name: "Take it anyway" }));
    await screen.findByRole("img", { name: "Your photo" });

    expect(row("Lighting")).toHaveAttribute("data-mark", "!");
    await user.click(screen.getByRole("button", { name: "Use this photo" }));
    await waitFor(() => expect(enrollment.enrollFace).toHaveBeenCalledOnce());
  });

  it("uses a working FaceDetector: two people is a warning", async () => {
    (globalThis as { FaceDetector?: unknown }).FaceDetector = class {
      detect = vi.fn().mockResolvedValue([
        { boundingBox: { x: 20, y: 20, width: 40, height: 50 } },
        { boundingBox: { x: 100, y: 20, width: 40, height: 50 } },
      ]);
    };
    const user = renderPage();
    await user.click(await screen.findByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("status", {}, { timeout: 2000 })).toHaveTextContent("Only one person should be in the picture.");
    await user.click(screen.getByRole("button", { name: "Take photo" }));
    await user.click(screen.getByRole("button", { name: "Take it anyway" }));
    await screen.findByRole("img", { name: "Your photo" });

    expect(row("Face")).toHaveAttribute("data-mark", "!");
    expect(screen.getByRole("button", { name: "Use this photo" })).toBeEnabled();
  });

  it("says 'Looking good' only when a face detector saw one centered face", async () => {
    (globalThis as { FaceDetector?: unknown }).FaceDetector = class {
      detect = vi.fn().mockResolvedValue([{ boundingBox: { x: 50, y: 25, width: 60, height: 70 } }]);
    };
    const user = renderPage();
    await user.click(await screen.findByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("status", {}, { timeout: 2000 })).toHaveTextContent("Looking good ✓");
  });
});

describe("EnrollPage: changing the photo", () => {
  async function captureAndUse(user: ReturnType<typeof userEvent.setup>) {
    await consentAndCapture(user);
    await user.click(screen.getByRole("button", { name: "Use this photo" }));
  }

  it("an enrolled ticket offers 'Change photo' instead of starting over", async () => {
    tickets.myTickets.mockResolvedValue([makeTicket("VALID", { enrolled: true })]);
    renderPage();

    expect(await screen.findByText("Face entry is already set up for this ticket ✓")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change photo" })).toHaveAttribute("href", "/enroll/42?replace=1");
  });

  it("replace mode asks consent again and sends the new photo with PUT", async () => {
    tickets.myTickets.mockResolvedValue([makeTicket("VALID", { enrolled: true })]);
    enrollment.replaceFace.mockResolvedValue({ ticket_id: 42, enrolled_at: "2026-10-12T10:00:00Z" });
    const user = renderPage(42, "?replace=1");

    expect(await screen.findByRole("heading", { name: "Change your face photo" })).toBeInTheDocument();
    await captureAndUse(user);

    expect(await screen.findByText("Your new photo is set!")).toBeInTheDocument();
    expect(screen.queryByTestId("confetti")).not.toBeInTheDocument(); // a calm finish when replacing
    expect(enrollment.replaceFace).toHaveBeenCalledWith(42, expect.any(Blob));
    expect(enrollment.enrollFace).not.toHaveBeenCalled();
  });

  it("?replace=1 on a ticket without a face is a normal first setup", async () => {
    tickets.myTickets.mockResolvedValue([makeTicket("VALID")]);
    enrollment.enrollFace.mockResolvedValue({ ticket_id: 42, enrolled_at: "2026-10-12T10:00:00Z" });
    const user = renderPage(42, "?replace=1");

    expect(await screen.findByRole("heading", { name: "Face entry" })).toBeInTheDocument();
    await captureAndUse(user);

    expect(await screen.findByText("Face entry is ready!")).toBeInTheDocument();
    expect(enrollment.enrollFace).toHaveBeenCalledOnce();
    expect(enrollment.replaceFace).not.toHaveBeenCalled();
  });

  it("a rejected new photo shows the tips and keeps you in replace mode", async () => {
    tickets.myTickets.mockResolvedValue([makeTicket("VALID", { enrolled: true })]);
    enrollment.replaceFace.mockRejectedValue(httpError(422, { message: "photo quality is too low", issues: ["NO_FACE"] }));
    const user = renderPage(42, "?replace=1");
    await screen.findByRole("heading", { name: "Change your face photo" });

    await captureAndUse(user);

    expect(await screen.findByText("We couldn't see a face. Center your face in the oval.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Change your face photo" })).toBeInTheDocument();
  });
});


describe("EnrollPage: step indicator", () => {
  const steps = () => within(screen.getByRole("navigation", { name: "Enrollment progress" })).getAllByRole("listitem");
  const current = () => steps().find((li) => li.getAttribute("aria-current") === "step")?.textContent;

  it("walks Consent -> Photo -> Review -> Done, ticking finished steps", async () => {
    enrollment.enrollFace.mockResolvedValue({ ticket_id: 42, enrolled_at: "2026-11-01T10:00:00Z" });
    const user = renderPage();

    await screen.findByRole("checkbox");
    expect(current()).toContain("Consent");
    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(current()).toContain("Photo");
    expect(steps()[0]).toHaveAttribute("data-state", "done");

    const take = screen.getByRole("button", { name: "Take photo" });
    await waitFor(() => expect(take).toBeEnabled());
    await user.click(take);
    await screen.findByRole("img", { name: "Your photo" });
    expect(current()).toContain("Review");

    await user.click(screen.getByRole("button", { name: "Use this photo" }));
    await screen.findByText("Face entry is ready!");
    expect(current()).toContain("Done");
    expect(steps().map((li) => li.getAttribute("data-state"))).toEqual(["done", "done", "done", "done"]);
    expect(screen.getByTestId("confetti")).toBeInTheDocument();
  });

  it("is not shown on a blocked ticket", async () => {
    tickets.myTickets.mockResolvedValue([makeTicket("PENDING_PAYMENT")]);
    renderPage();

    await screen.findByText(/Only paid, unused tickets/);
    expect(screen.queryByRole("navigation", { name: "Enrollment progress" })).not.toBeInTheDocument();
  });
});
