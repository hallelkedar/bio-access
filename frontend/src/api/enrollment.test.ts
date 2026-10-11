import { AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import { describe, expect, it, vi } from "vitest";

import { api } from "./client";
import { enrollFace } from "./enrollment";

describe("enrollFace", () => {
  it("sends the photo as a raw JPEG body with consent and ticket id", async () => {
    const seen: InternalAxiosRequestConfig[] = [];
    vi.spyOn(api.defaults, "adapter", "get").mockReturnValue(async (config: InternalAxiosRequestConfig) => {
      seen.push(config);
      return { data: { ticket_id: 42, enrolled_at: "x" }, status: 201, statusText: "", headers: {}, config };
    });
    const photo = new Blob(["jpeg"], { type: "image/jpeg" });

    await enrollFace(42, photo);

    const request = seen[0]!;
    expect(request.method).toBe("post");
    expect(request.url).toBe("/api/enrollment");
    expect(request.params).toEqual({ ticket_id: 42, consent: true });
    expect(AxiosHeaders.from(request.headers).get("Content-Type")).toBe("image/jpeg");
    expect(request.data).toBe(photo); // not wrapped in multipart/form-data
  });
});
