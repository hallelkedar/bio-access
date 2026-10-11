import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Camera } from "../components/Camera";
import { installFakeCamera, removeCamera } from "../test/fakeCamera";
import { cameraErrorMessage, useCamera } from "./useCamera";

afterEach(() => {
  vi.restoreAllMocks();
});

function CameraHarness({ overlay }: { overlay?: string }) {
  const camera = useCamera();
  return (
    <>
      <Camera camera={camera}>{overlay && <p>{overlay}</p>}</Camera>
      <span data-testid="status">{camera.status}</span>
    </>
  );
}

describe("useCamera", () => {
  it("goes requesting → ready and asks for video only", async () => {
    const fake = installFakeCamera();
    render(<CameraHarness />);

    expect(screen.getByText("Waiting for camera permission…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(fake.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false, video: expect.any(Object) }));
  });

  it("stops every track when the page goes away", async () => {
    const fake = installFakeCamera();
    const { unmount } = render(<CameraHarness />);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));

    unmount();

    expect(fake.track.stop).toHaveBeenCalled();
  });

  it("captures the frame as an in-memory JPEG", async () => {
    const fake = installFakeCamera({ width: 640, height: 480 });
    const { result } = renderHook(() => useCamera());
    result.current.videoRef.current = document.createElement("video");

    await act(() => result.current.start());
    const blob = await result.current.capture({ quality: 0.8 });

    expect(blob.type).toBe("image/jpeg");
    expect(fake.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.8);
    expect(fake.drawImage).toHaveBeenCalledWith(expect.any(HTMLVideoElement), 0, 0, 640, 480);
  });

  it("refuses to capture before the camera is ready", async () => {
    installFakeCamera();
    const { result } = renderHook(() => useCamera());

    await expect(result.current.capture()).rejects.toThrow("camera is not ready");
  });

  it("a start that is overtaken by stop releases its stream", async () => {
    const fake = installFakeCamera();
    let grant: (stream: MediaStream) => void = () => {};
    fake.getUserMedia.mockReturnValue(new Promise((resolve) => (grant = resolve)));
    const { result } = renderHook(() => useCamera());

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.start();
    });
    act(() => result.current.stop());
    await act(async () => {
      grant(fake.stream);
      await pending;
    });

    expect(fake.track.stop).toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });
});

describe("camera errors", () => {
  it.each([
    ["NotAllowedError", "blocked"],
    ["NotFoundError", "No camera found"],
    ["OverconstrainedError", "No camera found"],
    ["NotReadableError", "in use by another app"],
    ["SomethingElse", "Couldn't start the camera"],
  ])("%s → %s", (name, text) => {
    expect(cameraErrorMessage(new DOMException("x", name))).toContain(text);
  });

  it("shows the error with a Retry that starts again", async () => {
    const fake = installFakeCamera();
    fake.getUserMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    render(<CameraHarness />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Camera access was blocked");
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(fake.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("explains a missing camera API (insecure page)", async () => {
    installFakeCamera();
    removeCamera();
    render(<CameraHarness />);

    expect(await screen.findByRole("alert")).toHaveTextContent("secure page");
  });
});

describe("Camera overlay", () => {
  it("draws children over the video once ready", async () => {
    installFakeCamera();
    render(<CameraHarness overlay="Center your face" />);

    expect(screen.queryByText("Center your face")).not.toBeInTheDocument();
    expect(await screen.findByText("Center your face")).toBeInTheDocument();
    expect(screen.getByLabelText("Camera preview")).toHaveClass("-scale-x-100");
  });
});
