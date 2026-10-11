import type { InternalAxiosRequestConfig } from "axios";
import { describe, expect, it, vi } from "vitest";

import { uploadCover } from "./adminEvents";
import { api } from "./client";

describe("uploadCover", () => {
  it("sends the file as multipart form data", async () => {
    const seen: InternalAxiosRequestConfig[] = [];
    vi.spyOn(api.defaults, "adapter", "get").mockReturnValue(async (config: InternalAxiosRequestConfig) => {
      seen.push(config);
      return { data: {}, status: 200, statusText: "", headers: {}, config };
    });
    const file = new File(["png"], "cover.png", { type: "image/png" });

    await uploadCover(5, file);

    expect(seen[0]!.url).toBe("/api/events/5/cover");
    expect(seen[0]!.data).toBeInstanceOf(FormData);
    expect((seen[0]!.data as FormData).get("file")).toBe(file);
  });
});
