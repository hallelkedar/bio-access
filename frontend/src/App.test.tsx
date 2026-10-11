import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { routes } from "./App";

function renderAt(path: string) {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

describe("App routes", () => {
  it("shows the home page at /", () => {
    renderAt("/");

    expect(screen.getByRole("heading", { name: "Welcome to BioAccess" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "BioAccess" })).toHaveAttribute("href", "/");
  });

  it("shows not found for unknown paths", () => {
    renderAt("/no/such/page");

    expect(screen.getByRole("heading", { name: "Not found" })).toBeInTheDocument();
  });
});

describe("Header language toggle", () => {
  it("switches the header to Hebrew, right to left, and back", async () => {
    const user = userEvent.setup();
    renderAt("/");

    const english = screen.getByRole("button", { name: "English" });
    expect(english).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: "Log in" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hebrew" }));

    expect(screen.getByRole("link", { name: "התחברות" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "הרשמה" })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.lang).toBe("he");
    expect(screen.getByRole("button", { name: "עברית" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("group", { name: "שפה" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "אנגלית" }));

    expect(screen.getByRole("link", { name: "Log in" })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("the logo link keeps its plain name (the mark is decorative)", () => {
    renderAt("/");

    expect(screen.getByRole("link", { name: "BioAccess" }).querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("the toggle is reachable by keyboard", async () => {
    const user = userEvent.setup();
    renderAt("/");

    screen.getByRole("button", { name: "English" }).focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Hebrew" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(document.documentElement.dir).toBe("rtl");
  });
});
