"""Build frontend/src/data/cities.ts from GeoNames (CC BY 4.0).

Usage (from the repo root, network needed once):
    python3 -I scripts/build_cities.py

Downloads three GeoNames dump files into a temporary folder, reads them as data only,
and writes a small TypeScript list for the event form's city picker:
  - Israeli localities: the 100 most populous (cities5000, city sections excluded), with
    Hebrew and English names from alternatenames/IL.zip (preferred name first; English
    falls back to the plain ASCII name instead of scholarly spellings like "Petaẖ Tiqva");
  - world cities: every national capital with at least 500,000 people, then the most
    populous cities (at most 3 per country, so a few countries don't take every slot)
    until there are 250 (at 150, cities like Barcelona, Los Angeles and Dubai were cut).
A handful of fixes are applied by hand and listed below (EXCLUDE, HEBREW_FIXES).
Nothing from the download is committed except the generated file.
"""

import csv
import io
import sys
import tempfile
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

BASE = "https://download.geonames.org/export/dump/"
OUT = Path(__file__).resolve().parent.parent / "frontend" / "src" / "data" / "cities.ts"
ISRAEL_COUNT = 100
WORLD_COUNT = 250
CAPITAL_MIN_POPULATION = 500_000
PER_COUNTRY = 3
HEBREW = range(0x0590, 0x0600)
# Hand fixes, kept small and visible. GeoNames lists these as separate localities, but
# Qiryat HaYovel is a Jerusalem neighbourhood and "Yehud" duplicates Yehud-Monosson.
EXCLUDE = {("IL", "Qiryat HaYovel"), ("IL", "Yehud")}
# Israeli localities whose Hebrew name is missing from alternatenames/IL.zip.
HEBREW_FIXES = {
    "Modiin Ilit": "מודיעין עילית",
    "Rosh Ha‘Ayin": "ראש העין",
    "Yehud-Monosson": "יהוד-מונוסון",
    "Ariel": "אריאל",
}
# Sections of a city, historical, abandoned or destroyed places: not something to pick.
SKIP_FEATURES = {"PPLX", "PPLH", "PPLQ", "PPLW", "PPLCH"}
BIDI_MARKS = dict.fromkeys(map(ord, "\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069"))

csv.field_size_limit(sys.maxsize)


@dataclass
class Place:
    geoname_id: str
    name: str
    ascii_name: str
    feature_code: str
    country: str
    population: int


def download(name: str, folder: Path) -> Path:
    target = folder / name.replace("/", "_")
    with urllib.request.urlopen(BASE + name, timeout=120) as response:  # noqa: S310 (fixed https URL)
        target.write_bytes(response.read())
    return target


def read_tsv(data: bytes) -> list[list[str]]:
    text = io.StringIO(data.decode("utf-8"))
    return [row for row in csv.reader(text, delimiter="\t", quoting=csv.QUOTE_NONE) if row and not row[0].startswith("#")]


def zipped(path: Path, member: str) -> bytes:
    with zipfile.ZipFile(path) as archive:
        return archive.read(member)


def has_hebrew(text: str) -> bool:
    return any(ord(ch) in HEBREW for ch in text)


def names_in(rows: list[list[str]], language: str) -> dict[str, str]:
    """geonameid → best name in a language: preferred, not historic or colloquial, then shortest."""
    best: dict[str, tuple[int, int, str]] = {}
    for row in rows:
        _, geoname_id, lang, raw, preferred, short, colloquial, historic = (row + [""] * 10)[:8]
        name = raw.translate(BIDI_MARKS).strip()
        if lang != language or not name or colloquial == "1" or historic == "1":
            continue
        if language == "he" and not has_hebrew(name):
            continue
        rank = (0 if preferred == "1" else 1, len(name))
        if geoname_id not in best or rank < best[geoname_id][:2]:
            best[geoname_id] = (*rank, name)
    return {geoname_id: name for geoname_id, (_, _, name) in best.items()}


def ts_string(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="geonames-") as tmp:
        folder = Path(tmp)
        cities_zip = download("cities5000.zip", folder)
        il_zip = download("alternatenames/IL.zip", folder)
        countries = download("countryInfo.txt", folder)

        places = [
            Place(row[0], row[1], row[2], row[7], row[8], int(row[14] or 0))
            for row in read_tsv(zipped(cities_zip, "cities5000.txt"))
            if row[6] == "P" and row[7] not in SKIP_FEATURES  # real populated places only
        ]
        il_rows = read_tsv(zipped(il_zip, "IL.txt"))
        hebrew = names_in(il_rows, "he")
        english = names_in(il_rows, "en")
        country_names = {row[0]: row[4] for row in read_tsv(countries.read_bytes())}

    places = [p for p in places if (p.country, p.name) not in EXCLUDE]
    israel = sorted((p for p in places if p.country == "IL"), key=lambda p: -p.population)[:ISRAEL_COUNT]
    for p in israel:
        if p.geoname_id not in hebrew and p.name in HEBREW_FIXES:
            hebrew[p.geoname_id] = HEBREW_FIXES[p.name]
    missing_he = [p.name for p in israel if p.geoname_id not in hebrew]

    others = sorted((p for p in places if p.country != "IL"), key=lambda p: -p.population)
    world = [p for p in others if p.feature_code == "PPLC" and p.population >= CAPITAL_MIN_POPULATION]
    per_country: dict[str, int] = {}
    for p in world:
        per_country[p.country] = per_country.get(p.country, 0) + 1
    for p in others:
        if len(world) >= WORLD_COUNT:
            break
        if p in world or per_country.get(p.country, 0) >= PER_COUNTRY:
            continue
        world.append(p)
        per_country[p.country] = per_country.get(p.country, 0) + 1
    world.sort(key=lambda p: -p.population)

    lines = [
        "// Generated by scripts/build_cities.py: do not edit by hand.",
        "// City data from GeoNames (https://www.geonames.org/), licensed under CC BY 4.0",
        "// (https://creativecommons.org/licenses/by/4.0/). Selection, name choice and a few hand",
        "// fixes (listed in the script: EXCLUDE, HEBREW_FIXES) by the script.",
        "",
        "export interface City {",
        "  /** English (GeoNames) name. */",
        "  en: string;",
        "  /** Hebrew name, for Israeli localities. */",
        "  he?: string;",
        "  /** ISO 3166-1 alpha-2. */",
        "  country: string;",
        "}",
        "",
        "/** Country names for the hint next to each city (English, from GeoNames countryInfo). */",
        "export const COUNTRY_NAMES: Record<string, string> = {",
    ]
    used = sorted({p.country for p in [*israel, *world]})
    lines += [f"  {code}: {ts_string(country_names.get(code, code))}," for code in used]
    lines += ["};", "", "export const CITIES: City[] = ["]
    for p in israel:
        he = f", he: {ts_string(hebrew[p.geoname_id])}" if p.geoname_id in hebrew else ""
        en = english.get(p.geoname_id) or p.ascii_name
        lines.append(f'  {{ en: {ts_string(en)}{he}, country: "IL" }},')
    for p in world:
        lines.append(f"  {{ en: {ts_string(p.name)}, country: {ts_string(p.country)} }},")
    lines += ["];", ""]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.1f} KB): {len(israel)} Israeli, {len(world)} world, "
          f"{len(used)} countries; Israeli without a Hebrew name: {missing_he or 'none'}")


if __name__ == "__main__":
    main()
