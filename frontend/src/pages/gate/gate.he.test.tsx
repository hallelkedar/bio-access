import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as eventsApi from "../../api/events";
import * as gateApi from "../../api/gate";
import type { AccessReason } from "../../api/gate";
import { DENIAL_TEXT, denialText, hintText } from "../../gate/messages";
import { LANG_STORAGE_KEY, LanguageProvider } from "../../i18n/LanguageProvider";
import { installFakeCamera } from "../../test/fakeCamera";
import { makeEvent } from "../../test/factories.events";
import { GatePage } from "./GatePage";

vi.mock("../../api/events");
vi.mock("../../api/gate");
vi.mock("../../gate/sounds");

const REASONS = Object.keys(DENIAL_TEXT) as AccessReason[];

beforeEach(() => {
  installFakeCamera();
  vi.mocked(eventsApi.listEvents).mockResolvedValue([makeEvent({ id: 7, name: "Summer Concert" })]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("gate texts", () => {
  it("denialText: English matches DENIAL_TEXT, Hebrew exists for every reason", () => {
    for (const reason of REASONS) {
      expect(denialText("en", reason)).toBe(DENIAL_TEXT[reason]);
      if (reason !== "NONE") expect(denialText("he", reason)).toMatch(/[֐-׿]/);
    }
  });

  it("hintText fills the seconds", () => {
    expect(hintText("en", "rate_limited", { seconds: 3 })).toBe("Too many scans — resuming in 3 s");
    expect(hintText("he", "rate_limited", { seconds: 3 })).toBe("יותר מדי סריקות — ממשיכים בעוד 3 שניות");
  });
});

function renderGate(lang: "en" | "he") {
  localStorage.setItem(LANG_STORAGE_KEY, lang);
  const router = createMemoryRouter([
    { path: "*", element: <LanguageProvider><GatePage scannerOptions={{ holdMs: 5000 }} /></LanguageProvider> },
  ]);
  render(<RouterProvider router={router} />);
  return userEvent.setup();
}

function visibleTexts(): Set<string> {
  const texts = new Set<string>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    if (text) texts.add(text);
  }
  document.body.querySelectorAll("[aria-label], [placeholder]").forEach((el) => {
    for (const attr of ["aria-label", "placeholder"]) {
      const value = el.getAttribute(attr)?.trim();
      if (value) texts.add(value);
    }
  });
  return texts;
}

/** Setup screen, then the running terminal with the QR panel and a denial overlay. */
async function walkThrough(lang: "en" | "he"): Promise<Set<string>> {
  vi.mocked(gateApi.verifyQr).mockResolvedValue({
    result: "DENIED", reason: "ALREADY_ENTERED", ticket_id: 1, user_name: "Dana Levi", similarity: null,
  });
  const user = renderGate(lang);
  const texts = new Set<string>();
  const gateField = await screen.findByRole("textbox");
  visibleTexts().forEach((t) => texts.add(t));
  await user.type(gateField, "north-1");
  await user.click(screen.getByRole("button", { name: lang === "en" ? "Start" : "התחלה" }));
  await user.click(await screen.findByRole("button", { name: lang === "en" ? "QR fallback" : "כניסה עם QR" }));
  await user.type(screen.getByRole("textbox"), "token{Enter}");
  await screen.findByRole("alert");
  visibleTexts().forEach((t) => texts.add(t));
  cleanup();
  localStorage.clear();
  return texts;
}

describe("gate terminal in Hebrew", () => {
  it("shows no leftover English UI text (setup, terminal, QR panel, overlay)", async () => {
    const english = await walkThrough("en");
    const hebrew = await walkThrough("he");
    const data = new Set(["Summer Concert", "Dana Levi", "north-1", "QR", "✕", "✓"]);

    const leftovers = [...english].filter((text) => hebrew.has(text) && !data.has(text) && /[A-Za-z]{2,}/.test(text));

    expect(leftovers).toEqual([]);
    expect(hebrew.has("כבר נכנסתם")).toBe(true); // the denial overlay in Hebrew
    expect(hebrew.has("שער north-1")).toBe(true);
  });
});
