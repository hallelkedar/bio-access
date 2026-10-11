/** Guard: every admin screen in Hebrew shows no UI text it shows in English. */
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as adminApi from "../../api/admin";
import * as adminEvents from "../../api/adminEvents";
import * as adminStats from "../../api/adminStats";
import type { AccessEvent } from "../../api/adminStats";
import * as authApi from "../../api/auth";
import { setToken } from "../../auth/tokenStore";
import { reasonLabel, REASON_LABEL } from "../../components/charts/chartMath";
import { LANG_STORAGE_KEY } from "../../i18n/LanguageProvider";
import { makeUser } from "../../test/factories";
import { makeEvent } from "../../test/factories.events";
import { renderApp } from "../../test/renderApp";

vi.mock("../../api/auth");
vi.mock("../../api/admin");
vi.mock("../../api/adminEvents");
vi.mock("../../api/adminStats");
const FEED: AccessEvent[] = [
  { event_id: 7, gate_id: "north-1", method: "FACE", result: "DENIED", reason: "ALREADY_ENTERED",
    ticket_id: 1, user_name: "Dana Levi", similarity: 99, timestamp: "2026-12-01T18:05:00Z" },
];
vi.mock("../../hooks/useAdminFeed", () => ({ useAdminFeed: () => ({ status: "live", events: FEED }) }));

const DATA = new Set([
  "BioAccess", "EN", "עב", "Summer Concert", "Draft Party", "Tel Aviv", "Dana Levi", "Me Admin",
  "dana@example.com", "me@example.com", "north-1", "QR", "ILS", "—", "·",
]);

beforeEach(() => {
  vi.mocked(authApi.fetchMe).mockResolvedValue(makeUser("ADMIN", { id: 99, full_name: "Me Admin", email: "me@example.com" }));
  vi.mocked(adminEvents.listAllEvents).mockResolvedValue([
    makeEvent({ id: 7, name: "Summer Concert", status: "ACTIVE" }),
    makeEvent({ id: 5, name: "Draft Party", status: "DRAFT" }),
  ]);
  vi.mocked(adminStats.getEventStats).mockResolvedValue({
    event_id: 7,
    entries_per_30_min: [{ bucket_start: "2026-12-01T18:00:00Z", approved: 3 }],
    decisions: { approved: 3, denied: 1, denied_by_reason: { ALREADY_ENTERED: 1 }, approved_by_method: { FACE: 3, QR: 0 } },
    occupancy: { entered: 3, sold: 10, capacity: 100, percent: 3 },
  });
  vi.mocked(adminApi.listLogs).mockResolvedValue({
    items: [{ id: 1, timestamp: "2026-12-01T18:05:00Z", event_id: 7, gate_id: "north-1", method: "FACE",
      result: "DENIED", reason: "NOT_RECOGNIZED", similarity: null, ticket_id: null, user_name: null }],
    total: 60, limit: 50, offset: 0,
  });
  vi.mocked(adminApi.listUsers).mockResolvedValue({
    items: [makeUser("USER", { id: 12, full_name: "Dana Levi" }), makeUser("ADMIN", { id: 99, full_name: "Me Admin", email: "me@example.com" })],
    total: 2, limit: 50, offset: 0,
  });
  vi.mocked(adminApi.getSettings).mockResolvedValue({ face_match_threshold: 95, default_face_match_threshold: 95, source: "default" });
});

function visibleTexts(): Set<string> {
  const texts = new Set<string>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    if (text) texts.add(text);
  }
  document.body.querySelectorAll("[aria-label], [placeholder], [alt], [title]").forEach((el) => {
    for (const attr of ["aria-label", "placeholder", "alt", "title"]) {
      const value = el.getAttribute(attr)?.trim();
      if (value) texts.add(value);
    }
  });
  return texts;
}

type Walk = (lang: "en" | "he") => Promise<void>;

async function collect(path: string, lang: "en" | "he", walk: Walk): Promise<Set<string>> {
  localStorage.clear();
  localStorage.setItem(LANG_STORAGE_KEY, lang);
  setToken("jwt");
  renderApp(path);
  await walk(lang);
  const texts = visibleTexts();
  cleanup();
  sessionStorage.clear();
  return texts;
}

const waitFor = (en: string, he: string): Walk => async (lang) => {
  await screen.findAllByText(lang === "en" ? en : he);
};

const SCREENS: { name: string; path: string; walk: Walk }[] = [
  {
    name: "dashboard (with table view and all reasons)",
    path: "/admin",
    walk: async (lang) => {
      await screen.findAllByText(lang === "en" ? "Approved scans" : "סריקות שאושרו");
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: lang === "en" ? "View as table" : "הצגה כטבלה" }));
      await user.click(screen.getByRole("button", { name: lang === "en" ? "Show all reasons" : "הצגת כל הסיבות" }));
    },
  },
  {
    name: "events (with the edit form)",
    path: "/admin/events",
    walk: async (lang) => {
      await screen.findByText("Draft Party");
      await userEvent.setup().click(screen.getAllByRole("button", { name: lang === "en" ? "Edit" : "עריכה" })[0]!);
    },
  },
  { name: "logs", path: "/admin/logs", walk: waitFor("Clear filters", "ניקוי סינון") },
  { name: "users", path: "/admin/users", walk: waitFor("All roles", "כל התפקידים") },
  { name: "settings", path: "/admin/settings", walk: waitFor("Face match threshold", "סף התאמת פנים") },
];

describe("admin screens in Hebrew show no leftover English UI text", () => {
  it.each(SCREENS)("$name", async ({ path, walk }) => {
    const english = await collect(path, "en", walk);
    const hebrew = await collect(path, "he", walk);

    const leftovers = [...english].filter((text) => hebrew.has(text) && !DATA.has(text) && /[A-Za-z]{2,}/.test(text));

    expect(leftovers).toEqual([]);
  });
});

describe("reasonLabel", () => {
  it("English matches REASON_LABEL; Hebrew differs for every reason", () => {
    for (const reason of Object.keys(REASON_LABEL) as (keyof typeof REASON_LABEL)[]) {
      expect(reasonLabel("en", reason)).toBe(REASON_LABEL[reason]);
      expect(reasonLabel("he", reason)).not.toBe(REASON_LABEL[reason]);
    }
  });
});
