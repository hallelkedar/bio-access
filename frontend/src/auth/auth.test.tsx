import { screen, waitFor } from "@testing-library/react";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../api/auth";
import { api } from "../api/client";
import { renderApp } from "../test/renderApp";
import { httpError, makeUser } from "../test/factories";
import { getToken, setToken } from "./tokenStore";

vi.mock("../api/auth");
vi.mock("../api/events", () => ({ listEvents: vi.fn().mockResolvedValue([]) }));
vi.mock("../api/tickets", () => ({ myTickets: vi.fn().mockResolvedValue([]) }));
vi.mock("../api/adminEvents", () => ({ listAllEvents: vi.fn().mockResolvedValue([]) }));
vi.mock("../hooks/useAdminFeed", () => ({ useAdminFeed: () => ({ status: "live", events: [] }) }));
const mocked = vi.mocked(authApi);

beforeEach(() => {
  vi.mocked(authApi.login).mockReset();
  vi.mocked(authApi.register).mockReset();
  vi.mocked(authApi.fetchMe).mockReset();
});

async function fillLogin(user: ReturnType<typeof renderApp>["user"], email = "dana@example.com", password = "password123") {
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Log in" }));
}

describe("login", () => {
  it.each([
    ["USER", "/events", "Events"],  // the catalog page (empty here)
    ["GATEKEEPER", "/gate", "Gate terminal"],
    ["ADMIN", "/admin", "Admin dashboard"],
  ] as const)("a %s lands on %s", async (role, path, heading) => {
    mocked.login.mockResolvedValue("jwt-token");
    mocked.fetchMe.mockResolvedValue(makeUser(role));
    const { router, user } = renderApp("/login");

    await fillLogin(user);

    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(path);
    expect(getToken()).toBe("jwt-token");
    expect(screen.getByText("Dana Levi")).toBeInTheDocument();
    const navLinks = screen.queryAllByRole("link").map((link) => link.textContent);
    expect(navLinks.includes("My tickets")).toBe(role === "USER");
  });

  it("shows a clear message for a wrong password", async () => {
    mocked.login.mockRejectedValue(httpError(401, "invalid email or password"));
    const { user } = renderApp("/login");

    await fillLogin(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong email or password.");
    expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
    expect(getToken()).toBeNull();
  });

  it("explains rate limiting", async () => {
    mocked.login.mockRejectedValue(httpError(429, "rate limit exceeded"));
    const { user } = renderApp("/login");

    await fillLogin(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts");
  });
});

describe("register", () => {
  async function fillRegister(user: ReturnType<typeof renderApp>["user"]) {
    await user.type(screen.getByLabelText("Full name"), "Dana Levi");
    await user.type(screen.getByLabelText("Email"), "dana@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Register" }));
  }

  it("creates the account and logs in", async () => {
    mocked.register.mockResolvedValue(makeUser());
    mocked.login.mockResolvedValue("new-token");
    mocked.fetchMe.mockResolvedValue(makeUser());
    const { router, user } = renderApp("/register");

    await fillRegister(user);

    await waitFor(() => expect(router.state.location.pathname).toBe("/events"));
    expect(mocked.register).toHaveBeenCalledWith(
      expect.objectContaining({ email: "dana@example.com", full_name: "Dana Levi", password: "password123" }),
    );
    expect(getToken()).toBe("new-token");
  });

  it("reports a duplicate email", async () => {
    mocked.register.mockRejectedValue(httpError(409, "email already registered"));
    const { user } = renderApp("/register");

    await fillRegister(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("This email is already registered.");
  });

  it("shows the backend's field validation message", async () => {
    mocked.register.mockRejectedValue(
      httpError(422, [{ loc: ["body", "phone"], msg: "Value error, phone must be an international number like +972501234567" }]),
    );
    const { user } = renderApp("/register");

    await fillRegister(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("phone: phone must be an international number");
  });
});

describe("session", () => {
  it("restores the user from a stored token after reload", async () => {
    setToken("stored");
    mocked.fetchMe.mockResolvedValue(makeUser("ADMIN"));

    renderApp("/admin");

    expect(await screen.findByRole("heading", { name: "Admin dashboard" })).toBeInTheDocument();
  });

  it("drops a stored token the server rejects", async () => {
    setToken("revoked");
    mocked.fetchMe.mockRejectedValue(httpError(401));
    const { router } = renderApp("/events");

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(getToken()).toBeNull();
  });

  it("logout clears the token and the header", async () => {
    setToken("stored");
    mocked.fetchMe.mockResolvedValue(makeUser());
    const { user } = renderApp("/events");
    await screen.findByRole("heading", { name: "Events" });

    await user.click(screen.getByRole("button", { name: "Log out" }));

    expect(getToken()).toBeNull();
    expect(screen.getByRole("link", { name: "Log in" })).toBeInTheDocument();
  });

  it("a 401 from any request signs out and goes to login", async () => {
    setToken("soon-expired");
    mocked.fetchMe.mockResolvedValue(makeUser());
    const { router } = renderApp("/events");
    await screen.findByRole("heading", { name: "Events" });

    const adapter = async (config: InternalAxiosRequestConfig) => {
      throw new AxiosError("expired", "401", config, null, {
        data: {}, status: 401, statusText: "", headers: {}, config,
      });
    };
    await expect(api.get("/api/tickets/me", { adapter })).rejects.toBeInstanceOf(AxiosError);

    expect(await screen.findByText(/session expired/i)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.state).toEqual({ from: "/events" }); // returns there after login
    expect(getToken()).toBeNull();
  });
});

describe("ProtectedRoute", () => {
  it("sends anonymous users to login, then back where they were going", async () => {
    mocked.login.mockResolvedValue("jwt");
    mocked.fetchMe.mockResolvedValue(makeUser("ADMIN"));
    const { router, user } = renderApp("/admin");

    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
    await fillLogin(user);

    await waitFor(() => expect(router.state.location.pathname).toBe("/admin"));
  });

  it.each([
    ["USER", "/admin", "/events"],
    ["USER", "/gate", "/events"],
    ["GATEKEEPER", "/tickets", "/gate"],
    ["GATEKEEPER", "/admin/logs", "/gate"],
    ["ADMIN", "/events", "/admin"],
    ["ADMIN", "/gate", "/admin"],
  ] as const)("a %s opening %s is sent to their own home %s", async (role, path, home) => {
    setToken("stored");
    mocked.fetchMe.mockResolvedValue(makeUser(role));

    const { router } = renderApp(path);

    await waitFor(() => expect(router.state.location.pathname).toBe(home));
  });
});

describe("header user chip", () => {
  it("shows the translated role next to the name", async () => {
    setToken("stored");
    mocked.fetchMe.mockResolvedValue(makeUser("GATEKEEPER"));

    renderApp("/gate");

    expect(await screen.findByText("Gatekeeper")).toBeInTheDocument();
    expect(screen.getByText("Dana Levi")).toBeInTheDocument();
  });
});
