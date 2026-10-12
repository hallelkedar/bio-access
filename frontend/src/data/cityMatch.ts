// Finding cities by what people type, in Hebrew or English, and splitting the stored
// "Venue, City" location string. The city part is stored with its English name.
import { localeFor } from "../format";
import type { Lang } from "../i18n/translate";
import { CITIES, COUNTRY_NAMES, type City } from "./cities";

/** Lower case, no accents or niqqud, no apostrophes/geresh/hyphens, q→k, קריית→קרית. */
export function normalizeCity(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['‘’`׳״".\-־]/g, "")
    .replace(/q/g, "k")
    .replace(/יי/g, "י")
    .replace(/\s+/g, " ")
    .trim();
}

type Entry = { city: City; keys: string[] };
const INDEX: Entry[] = CITIES.map((city) => ({ city, keys: [city.en, city.he].filter(Boolean).map((n) => normalizeCity(n!)) }));

/** Best matches first: name starts with it, then a word starts with it, then contains it. Israel first on ties. */
export function searchCities(query: string, limit = 8): City[] {
  const q = normalizeCity(query);
  if (!q) return [];
  const ranked: { city: City; rank: number; order: number }[] = [];
  INDEX.forEach(({ city, keys }, order) => {
    let rank = Infinity;
    for (const key of keys) {
      if (key.startsWith(q)) rank = Math.min(rank, 0);
      else if (key.split(" ").some((word) => word.startsWith(q))) rank = Math.min(rank, 1);
      else if (key.includes(q)) rank = Math.min(rank, 2);
    }
    if (rank !== Infinity) ranked.push({ city, rank, order });
  });
  // CITIES lists Israel first, then by population: `order` keeps that within a rank.
  return ranked.sort((a, b) => a.rank - b.rank || a.order - b.order).slice(0, limit).map((r) => r.city);
}

/** The listed city with exactly this name (Hebrew or English, typing-insensitive). */
export function findCity(name: string): City | null {
  const key = normalizeCity(name);
  if (!key) return null;
  return INDEX.find((entry) => entry.keys.includes(key))?.city ?? null;
}

export function cityName(city: City, lang: Lang): string {
  return lang === "he" && city.he ? city.he : city.en;
}

/** "France" / "צרפת" from the browser's own data, with GeoNames' English name as fallback. */
export function countryName(code: string, lang: Lang): string {
  try {
    return new Intl.DisplayNames([localeFor(lang) ?? "en"], { type: "region" }).of(code) ?? COUNTRY_NAMES[code] ?? code;
  } catch {
    return COUNTRY_NAMES[code] ?? code;
  }
}

/** "Hall 2, Expo, Tel Aviv" → venue "Hall 2, Expo", city "Tel Aviv". No comma → all venue. */
export function splitLocation(location: string): { venue: string; cityText: string } {
  const comma = location.lastIndexOf(",");
  if (comma === -1) return { venue: location.trim(), cityText: "" };
  return { venue: location.slice(0, comma).trim(), cityText: location.slice(comma + 1).trim() };
}

export function composeLocation(venue: string, city: City): string {
  return `${venue.trim()}, ${city.en}`;
}

/** For display: the city part in the reader's language when it's a listed city. */
export function displayLocation(location: string, lang: Lang): { venue: string; city: string } {
  const { venue, cityText } = splitLocation(location);
  const city = cityText ? findCity(cityText) : null;
  return { venue, city: city ? cityName(city, lang) : cityText };
}
