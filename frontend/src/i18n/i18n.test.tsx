import { act, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "./en";
import { he } from "./he";
import { LANG_STORAGE_KEY, LanguageProvider, useLanguage } from "./LanguageProvider";
import { translate } from "./translate";

const wrapper = ({ children }: { children: ReactNode }) => <LanguageProvider>{children}</LanguageProvider>;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dictionaries", () => {
  it("en and he have exactly the same keys", () => {
    expect(Object.keys(he).sort()).toEqual(Object.keys(en).sort());
  });

  it("no Hebrew value is empty", () => {
    expect(Object.entries(he).filter(([, text]) => !text.trim())).toEqual([]);
  });
});

describe("translate", () => {
  it("looks up per language", () => {
    expect(translate("en", "header.logOut")).toBe("Log out");
    expect(translate("he", "header.logOut")).toBe("התנתקות");
  });

  it("fills {placeholders} and leaves missing ones visible", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const dictionary = en as Record<string, string>;
    dictionary["test.greeting"] = "Hello {name}, you have {count} tickets";

    expect(translate("en", "test.greeting", { name: "Dana", count: 2 })).toBe("Hello Dana, you have 2 tickets");
    expect(translate("en", "test.greeting", { name: "Dana" })).toBe("Hello Dana, you have {count} tickets");
    delete dictionary["test.greeting"];
  });

  it("an unknown key returns the key and warns in development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(translate("he", "no.such.key")).toBe("no.such.key");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no.such.key"));
  });
});

describe("LanguageProvider", () => {
  it("defaults to English, left to right", () => {
    const { result } = renderHook(() => useLanguage(), { wrapper });

    expect(result.current.lang).toBe("en");
    expect(result.current.dir).toBe("ltr");
    expect(document.documentElement.dir).toBe("ltr");
    expect(document.documentElement.lang).toBe("en");
  });

  it("switching to Hebrew flips the page to right to left and translates", () => {
    const { result } = renderHook(() => useLanguage(), { wrapper });

    act(() => result.current.setLang("he"));

    expect(result.current.t("nav.events")).toBe("אירועים");
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.lang).toBe("he");
  });

  it("remembers the choice for the next visit", () => {
    const first = renderHook(() => useLanguage(), { wrapper });
    act(() => first.result.current.setLang("he"));
    first.unmount();

    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe("he");
    const second = renderHook(() => useLanguage(), { wrapper });
    expect(second.result.current.lang).toBe("he");
  });

  it("ignores a garbage stored value", () => {
    localStorage.setItem(LANG_STORAGE_KEY, "klingon");

    const { result } = renderHook(() => useLanguage(), { wrapper });

    expect(result.current.lang).toBe("en");
  });

  it("keeps working when storage throws (private mode)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    const { result } = renderHook(() => useLanguage(), { wrapper });
    expect(result.current.lang).toBe("en");

    act(() => result.current.setLang("he"));
    expect(result.current.lang).toBe("he");
  });

  it("outside a provider, components get fixed English", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useLanguage());

    expect(result.current.lang).toBe("en");
    expect(result.current.t("header.logOut")).toBe("Log out");
    act(() => result.current.setLang("he"));
    expect(result.current.lang).toBe("en");
  });

  it("t is available to components", () => {
    function Label() {
      return <span>{useLanguage().t("header.logIn")}</span>;
    }

    render(<Label />, { wrapper });

    expect(screen.getByText("Log in")).toBeInTheDocument();
  });
});
