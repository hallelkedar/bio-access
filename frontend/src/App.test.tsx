import { render, screen } from "@testing-library/react";
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
