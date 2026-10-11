# Fonts

Self-hosted so the strict CSP (`default-src 'self'`) allows them; no Google Fonts or CDN.

| File | Font | Subset | License |
|---|---|---|---|
| `Inter-Variable-latin.woff2` | [Inter](https://github.com/rsms/inter), variable weight 100–900 | Latin | SIL OFL 1.1 (`Inter-OFL.txt`) |
| `Heebo-Variable-hebrew.woff2` | [Heebo](https://github.com/OdedEzer/heebo), variable weight 100–900 | Hebrew | SIL OFL 1.1 (`Heebo-OFL.txt`) |

Source: the Fontsource builds on jsDelivr (`inter:vf/latin-wght-normal`, `heebo:vf/hebrew-wght-normal`).
Each `@font-face` in `src/index.css` has a `unicode-range`, so Heebo downloads only when Hebrew text is shown.
