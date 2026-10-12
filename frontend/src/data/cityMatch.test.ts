import { describe, expect, it } from "vitest";

import { CITIES } from "./cities";
import { composeLocation, countryName, displayLocation, findCity, normalizeCity, searchCities, splitLocation } from "./cityMatch";

const names = (query: string) => searchCities(query).map((c) => c.en);

describe("searchCities", () => {
  it.each([
    ["תל", "Tel Aviv"],
    ["Jerus", "Jerusalem"],
    ["jerusalem", "Jerusalem"],
    ["ירוש", "Jerusalem"],
    ["haifa", "Haifa"],
    ["petah", "Petah Tikva"],
    ["kiryat yam", "Qiryat Yam"], // q/k
    ["קריית אונו", "Kiryat Ono"], // listed as קרית אונו
    ["sao paulo", "São Paulo"], // accents
    ["paris", "Paris"],
  ])("%j finds %s first", (query, first) => {
    expect(names(query)[0]).toBe(first);
  });

  it("matches words inside a name, and keeps Israel first on ties", () => {
    expect(names("aviv")).toContain("Tel Aviv");
    const ramat = names("ramat");
    expect(ramat.slice(0, 2)).toEqual(expect.arrayContaining(["Ramat Gan", "Ramat HaSharon"]));
  });

  it("finds nothing for nonsense or an empty query", () => {
    expect(searchCities("asdf")).toEqual([]);
    expect(searchCities("   ")).toEqual([]);
  });

  it("returns at most `limit` cities", () => {
    expect(searchCities("a", 5)).toHaveLength(5);
  });
});

describe("the city list", () => {
  it("has Israeli localities with Hebrew names, and world cities", () => {
    const israel = CITIES.filter((c) => c.country === "IL");
    expect(israel.length).toBeGreaterThanOrEqual(90);
    expect(israel.every((c) => c.he)).toBe(true);
    expect(CITIES.length - israel.length).toBeGreaterThanOrEqual(150);
  });
});

describe("findCity and locations", () => {
  it("finds a listed city by either name, ignoring typing details", () => {
    expect(findCity("tel aviv")?.en).toBe("Tel Aviv");
    expect(findCity("תל אביב-יפו")?.en).toBe("Tel Aviv");
    expect(findCity("Tel")).toBeNull(); // exact names only
    expect(findCity("asdf")).toBeNull();
  });

  it("splits at the last comma and composes with the English name", () => {
    expect(splitLocation("Hall 2, Expo, Tel Aviv")).toEqual({ venue: "Hall 2, Expo", cityText: "Tel Aviv" });
    expect(splitLocation("Here")).toEqual({ venue: "Here", cityText: "" });
    expect(composeLocation("  Haifa Port ", findCity("חיפה")!)).toBe("Haifa Port, Haifa");
  });

  it("shows the city in the reader's language when it's listed", () => {
    expect(displayLocation("Expo Tel Aviv, Tel Aviv", "he")).toEqual({ venue: "Expo Tel Aviv", city: "תל אביב-יפו" });
    expect(displayLocation("Expo Tel Aviv, Tel Aviv", "en")).toEqual({ venue: "Expo Tel Aviv", city: "Tel Aviv" });
    expect(displayLocation("Somewhere, Atlantis", "he")).toEqual({ venue: "Somewhere", city: "Atlantis" });
  });

  it("names countries in both languages", () => {
    expect(countryName("FR", "en")).toBe("France");
    expect(countryName("FR", "he")).toBe("צרפת");
  });

  it("normalizes Hebrew and English spelling variants", () => {
    expect(normalizeCity("Ra‘anana")).toBe(normalizeCity("Raanana"));
    expect(normalizeCity("קריית ים")).toBe(normalizeCity("קרית ים"));
  });
});
