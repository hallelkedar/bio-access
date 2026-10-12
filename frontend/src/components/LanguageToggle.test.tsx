import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { LanguageProvider } from "../i18n/LanguageProvider";
import { LanguageToggle } from "./LanguageToggle";

beforeEach(() => localStorage.clear());

describe("LanguageToggle", () => {
  it("keeps the EN | עב order in Hebrew and slides the thumb", async () => {
    const user = userEvent.setup();
    render(<LanguageProvider><LanguageToggle /></LanguageProvider>);
    const group = screen.getByRole("group", { name: "Language" });
    const thumb = screen.getByTestId("lang-thumb");
    expect(thumb).toHaveClass("translate-x-0");

    await user.click(screen.getByRole("button", { name: "Hebrew" }));

    expect(group).toHaveAttribute("dir", "ltr");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["EN", "עב"]);
    expect(screen.getByRole("button", { name: "עברית" })).toHaveAttribute("aria-pressed", "true");
    expect(thumb).toHaveClass("translate-x-full");
  });
});
