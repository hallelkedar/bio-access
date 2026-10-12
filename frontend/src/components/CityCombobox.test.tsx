import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { City } from "../data/cities";
import { LANG_STORAGE_KEY, LanguageProvider } from "../i18n/LanguageProvider";
import { CityCombobox } from "./CityCombobox";

beforeEach(() => localStorage.clear());

function renderBox(lang: "en" | "he" = "en") {
  localStorage.setItem(LANG_STORAGE_KEY, lang);
  const onCity = vi.fn();
  function Box() {
    const [city, setCity] = useState<City | null>(null);
    return <CityCombobox label="City" value={city} onChange={(next) => { setCity(next); onCity(next); }} />;
  }
  render(<LanguageProvider><Box /><button>elsewhere</button></LanguageProvider>);
  return { user: userEvent.setup(), onCity, input: screen.getByRole("combobox", { name: "City" }) };
}

describe("CityCombobox", () => {
  it("filters in Hebrew, shows the country, and Enter picks the first match", async () => {
    const { user, onCity, input } = renderBox("he");

    await user.type(input, "תל");
    const first = screen.getAllByRole("option")[0]!;
    expect(first).toHaveTextContent("תל אביב-יפו");
    expect(first).toHaveTextContent("ישראל");
    await user.keyboard("{Enter}");

    expect(onCity).toHaveBeenLastCalledWith(expect.objectContaining({ en: "Tel Aviv" }));
    expect(input).toHaveValue("תל אביב-יפו");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("moves through options with the arrows (aria-activedescendant) and picks with Enter", async () => {
    const { user, onCity, input } = renderBox();

    await user.type(input, "ramat");
    const options = screen.getAllByRole("option");
    expect(input).toHaveAttribute("aria-activedescendant", options[0]!.id);
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", options[1]!.id);
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");

    expect(onCity).toHaveBeenLastCalledWith(expect.objectContaining({ en: options[1]!.textContent!.replace(/Israel$/, "") }));
  });

  it("finds English names too, and a click picks", async () => {
    const { user, onCity, input } = renderBox();

    await user.type(input, "Jerus");
    await user.click(screen.getByRole("option", { name: /Jerusalem/ }));

    expect(onCity).toHaveBeenLastCalledWith(expect.objectContaining({ en: "Jerusalem" }));
    expect(input).toHaveValue("Jerusalem");
  });

  it("says when nothing matches, and refuses text that isn't a listed city", async () => {
    const { user, onCity, input } = renderBox();

    await user.type(input, "asdf");
    expect(screen.getByText("No matching city")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "elsewhere" }));

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Choose a city from the list.");
    expect(input).toHaveValue("asdf");
    expect(onCity).not.toHaveBeenCalled();
  });

  it("an exactly typed name counts when leaving the field; Esc just closes the list", async () => {
    const { user, onCity, input } = renderBox();

    await user.type(input, "haifa");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.tab();

    expect(onCity).toHaveBeenLastCalledWith(expect.objectContaining({ en: "Haifa" }));
    expect(input).toHaveValue("Haifa");
  });
});
