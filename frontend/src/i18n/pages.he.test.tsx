/**
 * Guard: every 5a page rendered in Hebrew must not show any UI text it shows in English.
 * (User data such as event and person names is the same in both and is allowed.)
 */
import { cleanup, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../api/auth";
import * as eventsApi from "../api/events";
import * as ticketsApi from "../api/tickets";
import { setToken } from "../auth/tokenStore";
import { makeUser } from "../test/factories";
import { makeEvent, makeTicket } from "../test/factories.events";
import { renderApp } from "../test/renderApp";
import { LANG_STORAGE_KEY } from "./LanguageProvider";

vi.mock("../api/auth");
vi.mock("../api/events");
vi.mock("../api/tickets");
vi.mock("../api/adminEvents", () => ({ listAllEvents: vi.fn().mockResolvedValue([]) }));
vi.mock("../hooks/useAdminFeed", () => ({ useAdminFeed: () => ({ status: "live", events: [] }) }));

const DATA = new Set(["BioAccess", "EN", "עב", "Summer Concert", "Winter Gala", "Tel Aviv", "Dana Levi", "Tel Aviv ·", "·"]);

function visibleTexts(root: HTMLElement): Set<string> {
  const texts = new Set<string>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    if (text) texts.add(text);
  }
  root.querySelectorAll("[aria-label], [placeholder], [alt], [title]").forEach((el) => {
    for (const attr of ["aria-label", "placeholder", "alt", "title"]) {
      const value = el.getAttribute(attr)?.trim();
      if (value) texts.add(value);
    }
  });
  return texts;
}

async function textsAt(path: string, lang: "en" | "he", ready: string, signedIn: boolean): Promise<Set<string>> {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(LANG_STORAGE_KEY, lang);
  if (signedIn) setToken("jwt");
  renderApp(path);
  await screen.findAllByText(ready);
  const texts = visibleTexts(document.body);
  cleanup();
  return texts;
}

beforeEach(() => {
  vi.mocked(authApi.fetchMe).mockResolvedValue(makeUser("USER"));
  vi.mocked(eventsApi.listEvents).mockResolvedValue([makeEvent(), makeEvent({ id: 8, name: "Winter Gala" })]);
  vi.mocked(ticketsApi.myTickets).mockResolvedValue([
    makeTicket("VALID", { id: 42 }),
    makeTicket("PENDING_PAYMENT", { id: 43, event_id: 8, event: { ...makeTicket("VALID").event, id: 8, name: "Summer Concert" } }),
  ]);
  vi.mocked(ticketsApi.fetchQrImage).mockResolvedValue("blob:qr");
  URL.revokeObjectURL = vi.fn();
});

const PAGES: { path: string; en: string; he: string; signedIn: boolean }[] = [
  { path: "/", en: "Welcome to BioAccess", he: "ברוכים הבאים ל-BioAccess", signedIn: false },
  { path: "/no/such/page", en: "Not found", he: "הדף לא נמצא", signedIn: false },
  { path: "/login", en: "No account?", he: "אין לכם חשבון?", signedIn: false },
  { path: "/register", en: "Create an account", he: "יצירת חשבון", signedIn: false },
  { path: "/events", en: "Complete payment", he: "להשלמת התשלום", signedIn: true },
  { path: "/tickets", en: "Set up face entry", he: "להגדרת כניסה בפנים", signedIn: true },
  { path: "/enroll/42", en: "Before we start", he: "לפני שמתחילים", signedIn: true },
  { path: "/checkout/success?ticket_id=42", en: "Payment received!", he: "התשלום התקבל!", signedIn: true },
  { path: "/checkout/cancel?ticket_id=42", en: "Payment cancelled", he: "התשלום בוטל", signedIn: true },
  { path: "/admin", en: "Not allowed", he: "אין הרשאה", signedIn: true },
];

describe("Hebrew pages show no leftover English UI text", () => {
  it.each(PAGES)("$path", async ({ path, en, he, signedIn }) => {
    const english = await textsAt(path, "en", en, signedIn);
    const hebrew = await textsAt(path, "he", he, signedIn);

    const leftovers = [...english].filter((text) => hebrew.has(text) && !DATA.has(text) && /[A-Za-z]{2,}/.test(text));

    expect(leftovers).toEqual([]);
    expect(document.documentElement.dir).toBe("rtl");
  });
});
