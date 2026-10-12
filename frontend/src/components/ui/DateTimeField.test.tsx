import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LANG_STORAGE_KEY, LanguageProvider } from "../../i18n/LanguageProvider";
import { DateTimeField } from "./DateTimeField";

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] }); // only the clock: userEvent keeps real timers
  vi.setSystemTime(new Date(2026, 9, 12, 10, 0)); // Monday 12 Oct 2026, 10:00
});

afterEach(() => {
  vi.useRealTimers();
});

function renderField({ initial = null, lang = "en", ...props }: { initial?: string | null; lang?: "en" | "he"; min?: string; max?: string; error?: string } = {}) {
  localStorage.setItem(LANG_STORAGE_KEY, lang);
  const onValue = vi.fn();
  function Field() {
    const [value, setValue] = useState<string | null>(initial);
    return (
      <DateTimeField label="Starts" value={value} defaultTime="19:00" {...props}
        onChange={(next) => { setValue(next); onValue(next); }} />
    );
  }
  render(<LanguageProvider><Field /></LanguageProvider>);
  return { user: userEvent.setup(), onValue, input: screen.getByLabelText("Starts") as HTMLInputElement };
}

const openButton = () => screen.getByRole("button", { name: /Open calendar|פתיחת לוח השנה/ });
const day = (label: string | RegExp) => screen.getByRole("button", { name: label });

describe("DateTimeField: typing", () => {
  it("accepts the English order and reports UTC ISO", async () => {
    const { user, onValue, input } = renderField();

    await user.type(input, "12/24/2026 19:30");
    expect(onValue).not.toHaveBeenCalled(); // nothing partial leaks out while typing
    await user.tab();

    expect(onValue).toHaveBeenLastCalledWith(local(2026, 12, 24, 19, 30));
    expect(input).toHaveValue("12/24/2026 19:30");
  });

  it("accepts the day-first order in Hebrew", async () => {
    const { user, onValue, input } = renderField({ lang: "he" });

    await user.type(input, "24.12.2026 19:30{Enter}");

    expect(onValue).toHaveBeenLastCalledWith(local(2026, 12, 24, 19, 30));
    expect(input).toHaveValue("24/12/2026 19:30");
  });

  it("shows a message for invalid text and reports null instead of a stale value", async () => {
    const { user, onValue, input } = renderField({ initial: local(2026, 12, 24, 19, 0) });
    expect(input).toHaveValue("12/24/2026 19:00");

    await user.clear(input);
    await user.type(input, "02/31/2026 10:00");
    await user.tab();

    expect(onValue).toHaveBeenLastCalledWith(null);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter a date and time like mm/dd/yyyy hh:mm");
    expect(input).toHaveValue("02/31/2026 10:00"); // kept so it can be fixed
  });

  it("rejects typed values outside min/max", async () => {
    const { user, onValue, input } = renderField({ min: local(2026, 10, 10, 12, 0) });

    await user.type(input, "10/10/2026 11:00{Enter}");

    expect(input).toHaveAccessibleDescription("Choose 10/10/2026 12:00 or later");
    expect(onValue).not.toHaveBeenCalledWith(expect.any(String));
  });

  it("shows the parent's error until its own check has something to say", () => {
    renderField({ error: "End must be after start" });

    expect(screen.getByLabelText("Starts")).toHaveAccessibleDescription("End must be after start");
  });
});

describe("DateTimeField: calendar", () => {
  it("navigates months", async () => {
    const { user } = renderField();
    await user.click(openButton());

    expect(screen.getByRole("dialog", { name: "Choose a date" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("heading", { name: "November 2026" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByRole("heading", { name: "September 2026" })).toBeInTheDocument();
  });

  it("selects with the keyboard and closes with Esc back on the button", async () => {
    const { user, onValue, input } = renderField();
    await user.click(openButton());
    expect(day("Monday, October 12, 2026")).toHaveFocus(); // starts on today
    expect(day("Monday, October 12, 2026")).toHaveAttribute("aria-current", "date");

    await user.keyboard("{ArrowRight}{ArrowDown}{PageDown}"); // +1 day, +1 week, +1 month
    expect(day("Friday, November 20, 2026")).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(onValue).toHaveBeenLastCalledWith(local(2026, 11, 20, 19, 0)); // defaultTime
    expect(input).toHaveValue("11/20/2026 19:00");
    expect(day("Friday, November 20, 2026").parentElement).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Home}");
    expect(day("Sunday, November 15, 2026")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(openButton()).toHaveFocus();
  });

  it("mirrors the arrow keys in Hebrew", async () => {
    const { user } = renderField({ lang: "he" });
    await user.click(openButton());
    const start = document.activeElement;

    await user.keyboard("{ArrowLeft}");

    expect(start).toHaveAttribute("data-day", "2026-10-12");
    expect(document.activeElement).toHaveAttribute("data-day", "2026-10-13");
  });

  it("disables days outside min/max", async () => {
    const { user, onValue } = renderField({ min: local(2026, 10, 10, 12, 0), max: local(2026, 10, 20, 9, 0) });
    await user.click(openButton());

    expect(day("Friday, October 9, 2026")).toHaveAttribute("aria-disabled", "true");
    expect(day("Saturday, October 10, 2026")).not.toHaveAttribute("aria-disabled");
    expect(day("Wednesday, October 21, 2026")).toHaveAttribute("aria-disabled", "true");
    await user.click(day("Friday, October 9, 2026"));
    expect(onValue).not.toHaveBeenCalled();
  });

  it("steps the time by 5 minutes and applies it to the chosen day", async () => {
    const { user, onValue, input } = renderField({ initial: local(2026, 12, 24, 19, 7) });
    await user.click(openButton());
    const time = screen.getByLabelText("Time");
    expect(time).toHaveValue("19:07");

    await user.click(time);
    await user.keyboard("{ArrowUp}");

    expect(time).toHaveValue("19:10");
    expect(onValue).toHaveBeenLastCalledWith(local(2026, 12, 24, 19, 10));
    expect(input).toHaveValue("12/24/2026 19:10");
  });

  it("Today picks today; a click outside closes", async () => {
    const { user, onValue } = renderField();
    await user.click(openButton());

    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(onValue).toHaveBeenLastCalledWith(local(2026, 10, 12, 19, 0));

    await user.click(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([
    ["en", "Sunday", "October 2026"],
    ["he", "יום ראשון", "אוקטובר 2026"],
  ] as const)("starts the week on Sunday in %s, with localized names", async (lang, firstDay, title) => {
    const { user } = renderField({ lang });
    await user.click(openButton());

    expect(screen.getAllByRole("columnheader")[0]).toHaveAccessibleName(firstDay);
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
  });
});
