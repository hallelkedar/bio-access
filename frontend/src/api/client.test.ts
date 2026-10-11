import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import { describe, expect, it, vi } from "vitest";

import { getToken, setToken } from "../auth/tokenStore";
import { api, setUnauthorizedHandler } from "./client";

// Run a request through the real interceptors, with a fake transport instead of the network.
function sendWith(status: number) {
  const seen: InternalAxiosRequestConfig[] = [];
  const adapter = async (config: InternalAxiosRequestConfig) => {
    seen.push(config);
    const response = { data: {}, status, statusText: "", headers: {}, config };
    if (status >= 400) {
      throw new AxiosError("failed", String(status), config, null, response);
    }
    return response;
  };
  return { request: api.get("/api/auth/me", { adapter }), seen };
}

describe("api client", () => {
  it("adds the bearer token when one is stored", async () => {
    setToken("abc.def.ghi");
    const { request, seen } = sendWith(200);
    await request;

    expect(AxiosHeaders.from(seen[0]!.headers).get("Authorization")).toBe("Bearer abc.def.ghi");
  });

  it("sends no Authorization header without a token", async () => {
    const { request, seen } = sendWith(200);
    await request;

    expect(AxiosHeaders.from(seen[0]!.headers).has("Authorization")).toBe(false);
  });

  it("on 401 clears the token and calls the handler", async () => {
    setToken("expired");
    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    await expect(sendWith(401).request).rejects.toBeInstanceOf(AxiosError);

    expect(getToken()).toBeNull();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("other errors keep the token", async () => {
    setToken("still-good");
    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    await expect(sendWith(500).request).rejects.toBeInstanceOf(AxiosError);

    expect(getToken()).toBe("still-good");
    expect(handler).not.toHaveBeenCalled();
  });
});
