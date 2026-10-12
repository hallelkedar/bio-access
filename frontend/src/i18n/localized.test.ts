import { describe, expect, it } from "vitest";

import { apiErrorMessage } from "../api/errors";
import { formatDateTime, formatPrice } from "../format";
import { cameraErrorKey, cameraErrorMessage } from "../hooks/useCamera";
import { qualityTip, QUALITY_TIPS } from "../pages/user/EnrollPage";
import { httpError } from "../test/factories";
import { translate } from "./translate";

describe("apiErrorMessage in Hebrew", () => {
  it("translates known server texts; English stays the server's own wording", () => {
    const soldOut = httpError(409, "event is sold out");

    expect(apiErrorMessage(soldOut)).toBe("Event is sold out");
    expect(apiErrorMessage(soldOut, {}, "he")).toBe("האירוע אזל");
  });

  it("falls back to the server's English for unknown texts", () => {
    expect(apiErrorMessage(httpError(409, "something new"), {}, "he")).toBe("Something new");
  });

  it("generic messages and field errors", () => {
    expect(apiErrorMessage(new Error("x"), {}, "he")).toBe("משהו השתבש. נסו שוב.");
    expect(apiErrorMessage(httpError(429), {}, "he")).toContain("יותר מדי ניסיונות");
    const field = httpError(422, [{ loc: ["body", "phone"], msg: "Value error, bad" }]);
    expect(apiErrorMessage(field, {}, "he")).toBe("טלפון: הערך אינו תקין");
    expect(apiErrorMessage(field)).toBe("phone: bad"); // English unchanged
  });

  it("page messages passed by status win", () => {
    expect(apiErrorMessage(httpError(401), { 401: "סיסמה שגויה" }, "he")).toBe("סיסמה שגויה");
  });
});

describe("formatting by language", () => {
  it("Hebrew uses Israeli formats", () => {
    expect(formatPrice(5000, "ILS", "he")).toMatch(/50\.00[\s\u200f]*₪/); // Intl adds right-to-left marks
    expect(formatDateTime("2026-12-01T18:00:00Z", "he")).toMatch(/2026/);
    expect(formatDateTime("2026-12-01T18:00:00Z", "he")).not.toMatch(/[A-Za-z]/);
  });
});

describe("compatibility helpers keep English", () => {
  it("camera messages and quality tips", () => {
    const blocked = new DOMException("x", "NotAllowedError");

    expect(cameraErrorKey(blocked)).toBe("camera.blocked");
    expect(cameraErrorMessage(blocked)).toBe(translate("en", "camera.blocked"));
    expect(qualityTip("en", "TOO_DARK")).toBe(QUALITY_TIPS.TOO_DARK);
    expect(qualityTip("he", "TOO_DARK")).toBe("חשוך מדי. עמדו מול חלון או מנורה.");
  });
});
