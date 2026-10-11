import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "./api/auth";
import type { Role } from "./api/types";
import { setToken } from "./auth/tokenStore";
import { makeUser } from "./test/factories";
import { renderApp } from "./test/renderApp";

vi.mock("./api/auth");
vi.mock("./api/events", () => ({ listEvents: vi.fn().mockResolvedValue([]) }));
vi.mock("./api/tickets", () => ({ myTickets: vi.fn().mockResolvedValue([]) }));
vi.mock("./api/adminEvents", () => ({ listAllEvents: vi.fn().mockResolvedValue([]) }));
vi.mock("./hooks/useAdminFeed", () => ({ useAdminFeed: () => ({ status: "live", events: [] }) }));

const header = () => within(screen.getByRole("banner"));

async function signedInAs(role: Role, path = "/") {
  setToken("jwt");
  vi.mocked(authApi.fetchMe).mockResolvedValue(makeUser(role));
  const view = renderApp(path);
  await header().findByRole("button", { name: "Log out" });
  return view;
}

beforeEach(() => {
  vi.mocked(authApi.fetchMe).mockReset();
});

describe("header nav per role", () => {
  it.each([
    ["USER", ["Events", "My tickets"]],
    ["GATEKEEPER", ["Gate"]],
    ["ADMIN", ["Dashboard", "Events", "Logs", "Users", "Settings"]],
  ] as const)("%s sees %j", async (role, labels) => {
    await signedInAs(role);

    const links = within(header().getByRole("navigation").querySelector("#main-nav-links") as HTMLElement)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(links).toEqual(labels);
  });

  it("guests see Home, Log in and Register", () => {
    renderApp("/");

    expect(header().getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(header().getByRole("link", { name: "Log in" })).toBeInTheDocument();
    expect(header().getByRole("link", { name: "Register" })).toBeInTheDocument();
  });

  it("admin links point at the admin pages and mark the current one", async () => {
    await signedInAs("ADMIN", "/admin/logs");

    expect(header().getByRole("link", { name: "Logs" })).toHaveAttribute("aria-current", "page");
    expect(header().getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
    expect(header().getByRole("link", { name: "Users" })).toHaveAttribute("href", "/admin/users");
  });
});

describe("mobile menu", () => {
  it("opens, closes on Escape (focus back on the button) and after navigating", async () => {
    const { user } = await signedInAs("ADMIN", "/admin");
    const button = header().getByRole("button", { name: "Menu" });
    const links = document.getElementById("main-nav-links")!;
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-controls", "main-nav-links");
    expect(links).toHaveClass("hidden");

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(links).toHaveClass("flex");

    await user.keyboard("{Escape}");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();

    await user.click(button);
    await user.click(header().getByRole("link", { name: "Logs" }));
    await waitFor(() => expect(button).toHaveAttribute("aria-expanded", "false"));
  });
});

describe("landing page buttons follow the role", () => {
  const hero = () => within(screen.getByRole("heading", { level: 1 }).closest("section")!);

  it("guests: Get started and Log in", () => {
    renderApp("/");

    expect(hero().getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/register");
    expect(hero().getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
  });

  it.each([
    ["USER", [["My tickets", "/tickets"], ["Browse events", "/events"]]],
    ["GATEKEEPER", [["Open the gate", "/gate"]]],
    ["ADMIN", [["Open the dashboard", "/admin"], ["Manage events", "/admin/events"]]],
  ] as const)("%s", async (role, expected) => {
    await signedInAs(role);

    const links = hero().getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")]);
    expect(links).toEqual(expected);
  });

  it("shows the how-it-works steps and the stats note", () => {
    renderApp("/");

    expect(screen.getByRole("heading", { name: "How it works" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").filter((li) => li.textContent?.includes("Step"))).toHaveLength(3);
    expect(screen.getByText("Design targets and guarantees of the system, not live data.")).toBeInTheDocument();
  });
});

describe("signed-in users skip the login and register forms", () => {
  it.each(["/login", "/register"])("%s → own home", async (path) => {
    setToken("jwt");
    vi.mocked(authApi.fetchMe).mockResolvedValue(makeUser("GATEKEEPER"));

    const { router } = renderApp(path);

    await waitFor(() => expect(router.state.location.pathname).toBe("/gate"));
  });
});
