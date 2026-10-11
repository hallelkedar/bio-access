# UI_PLAN.md — שדרוג ה-UI של BioAccess ל"וואו"

> קובץ הוראות ל-Claude Code. עובדים לפי `CLAUDE.md` של הריפו: קודם תוכנית, צעד אחד = קומיט אחד, לא עושים קומיט לפני שהאדם אישר, ולא מוסיפים תלות (dependency) בלי לשאול.

## החלטות שכבר התקבלו

| נושא | החלטה |
|---|---|
| היקף | שלושה מסכי וואו (דף נחיתה, מסוף שער, דשבורד חי) + מערכת עיצוב משותפת |
| כיוון חזותי | היברידי: האפליקציה בהירה, מסוף השער והדשבורד כהים כמו חדר בקרה |
| שפה | מתג עברית/אנגלית כתוב ידנית, בלי ספריית i18n, עם תמיכה ב-RTL |
| אנימציות | CSS בלבד (בלי framer-motion), עם כיבוד `prefers-reduced-motion` |

> **עדכון (חלק ב'):** בסוף הקובץ נוספו שלבים 12–21 (תיקוני טפסים, לוגים, דשבורד, הכרטיסים שלי, ולידציית תמונה, אייקון). סדר מומלץ מופיע שם. שלבים 7–8 מבוצעים לפני חלק ב'. שלב 9 אוחד לתוך שלב 18, ושלב 10 אוחד לתוך שלבים 19 ו-21 (לא מבצעים אותם בנפרד). שלב 11 (בדיקות סופיות) מבוצע **אחרון**, אחרי חלק ב'.

## חוקי ברזל (לקרוא לפני כל צעד)

1. **אין שבירת טסטים.** יש 142 טסטי פרונט שמצפים למחרוזות באנגלית. שפת ברירת המחדל נשארת `en`. טסט שצריך לעדכן = עוצרים ושואלים.
2. **CSP.** ב-`frontend/security-headers.conf` יש `style-src 'self'` ו-`script-src 'self'`. לכן: אין Google Fonts, אין CDN, אין `<style>` או `<script>` inline ב-HTML. פונטים נשמרים בריפו ונטענים מאותו origin. שימו לב: `style={{...}}` של React עובד (זה מאפיין DOM, לא inline של HTML שנטען), אבל לא להוסיף תגיות `<style>`.
3. **אין תלויות חדשות** בלי לשאול. מותר: CSS, SVG, Web Audio שכבר קיים, `requestAnimationFrame`.
4. **לא נוגעים בלוגיקה** של `useGateScanner`, `motion.ts`, `useAdminFeed`, ה-API וה-backend. משנים רק תצוגה, ועטיפות תצוגה. **חריגים מאושרים (חלק ב' בלבד):** שלב 16 (ולידטור מיקום ב-`EventCreate`/`EventUpdate`) ושלב 19 (שדה `status` באירוע המקונן ב-`MyTicket`). גם בהם: מציגים תוכנית ומחכים לאישור לפני שנוגעים ב-backend, ומריצים `pytest` בנוסף לבדיקות הפרונט.
5. **נגישות:** ניגודיות סבירה, `aria-label` על כפתורים עם אייקון בלבד, `prefers-reduced-motion` מבטל אנימציות.
6. כל צעד מסתיים ב: `npm run build`, `npm test` (בתיקיית `frontend`) ו-`npm run lint` אם קיים. רק אם הכול ירוק עוברים הלאה.

## תהליך עבודה לכל צעד

1. הדביקו ל-Claude Code את ה-Prompt של הצעד, **במצב תוכנית** (Shift+Tab פעמיים).
2. קראו את התוכנית, אשרו.
3. הריצו את שלב ה"אימות" ובדקו בעיניים בדפדפן (`npm run dev`).
4. רק אז תגידו לו לעשות קומיט. הודעת קומיט בפורמט שבריפו.

---

## שלב 0 — הכנה

**Prompt:**
```
Read CLAUDE.md and README.md. Create a branch `feat/ui-wow`.
Run the frontend tests and the build and report the baseline (expected: 142 passing).
Then list every place in frontend/src that renders user-visible English text
(pages, components, gate/messages.ts, chartMath.ts REASON_LABEL, DashboardPage PILL).
Do not change any code yet.
```
**אימות:** דוח עם 142 טסטים ירוקים ורשימת הקבצים. זו הרשימה שתעבדו ממנה בשלב 5.

---

## שלב 1 — פונטים עצמאיים (Self-hosted) וטוקנים

**מטרה:** זהות חזותית אחת, בלי לשבור CSP.

**Prompt:**
```
Goal: a design-token foundation in frontend/src/index.css using Tailwind v4 @theme.

1. Fonts: we cannot use Google Fonts (CSP style-src 'self'). Ask me to download two
   variable fonts as woff2 into frontend/src/assets/fonts/: Inter (Latin) and Heebo (Hebrew).
   Do NOT add an npm package. Declare them with @font-face in index.css and a
   font stack: "Inter", "Heebo", system-ui, sans-serif.
2. In vite.config set build.assetsInlineLimit = 0 so fonts are emitted as files and
   not inlined as data: URIs (font-src falls back to default-src 'self').
3. Define tokens in @theme: brand colors (an indigo -> cyan accent), semantic colors
   (ok = emerald, deny = rose, warn = amber), radii, shadows, and a "glow" shadow.
4. Add a dark scope: a `.theme-dark` class that overrides the CSS variables
   (surface, surface-2, text, muted, border) for the control-room look.
5. Keep the existing pages visually working; only the foundation changes now.
```
**אימות:** `npm run build` עובר; בתיקיית `dist/assets` יש קבצי `.woff2`; בדפדפן, בלשונית Network, הפונטים נטענים מאותו דומיין; בלי שגיאות CSP בקונסול. הטסטים ירוקים.

---

## שלב 2 — ליבת i18n ידנית

**מטרה:** מנגנון תרגום קטן וקריא שאתה מבין.

**Prompt:**
```
Create frontend/src/i18n/ with:
- en.ts and he.ts: flat dictionaries (`as const`), he typed as the same keys as en.
- LanguageProvider + useLanguage(): { lang, setLang, t, dir }.
  `t(key, vars?)` supports simple {name} interpolation. Missing key -> returns the key
  and console.warn in dev only.
- Default lang = "en". The choice is saved to localStorage under "bioaccess.lang",
  wrapped in try/catch (storage can throw). Read it once on startup.
- An effect sets document.documentElement.lang and .dir ("rtl" for he).
- Export a pure helper `translate(lang, key, vars)` so non-React code can use it.
Add unit tests: default is en, switching to he sets dir=rtl, interpolation, persistence
(mock localStorage), localStorage throwing does not crash.
Wire LanguageProvider into RootLayout in App.tsx and into the test helper renderApp.tsx
(default stays en so existing tests are unchanged).
```
**אימות:** הטסטים החדשים עוברים; כל 142 הישנים עוברים; בקונסול הדפדפן `document.documentElement.dir` משתנה כשמחליפים שפה ידנית.

---

## שלב 3 — מתג שפה ו-Header חדש

**Prompt:**
```
Build a LanguageToggle component (segmented control "EN | עב", aria-pressed, keyboard
accessible) and redesign the Header in App.tsx: glass-style bar, logo mark + wordmark,
role-based nav as before, language toggle, user menu/logout.
Use logical Tailwind utilities (ms-*, me-*, ps-*, pe-*, start-*, end-*, text-start)
instead of left/right so RTL works. Translate every header string via t().
Keep all existing text in English by default so App.test.tsx still passes.
Add a test: clicking the toggle changes a header label to Hebrew and sets dir=rtl.
```
**אימות:** מחליפים שפה: הכיוון מתהפך, התפריט מסתדר, אין "קפיצות". טסטים ירוקים.

---

## שלב 4 — רכיבי UI משותפים ואנימציות

**Prompt:**
```
Create frontend/src/components/ui/ with small, typed, presentational components:
Button (variants: primary/ghost/danger, sizes), Card, Badge, Spinner, Reveal
(fade/slide-in on scroll using IntersectionObserver, falls back to visible when
unsupported or when prefers-reduced-motion), and CountUp (animates a number with
requestAnimationFrame, shows the final value instantly under reduced motion).
Define keyframes in index.css (fade-up, pulse-ring, scan-line, shimmer) and make a
global @media (prefers-reduced-motion: reduce) rule that disables them.
Add a short test for CountUp (final value renders) and Reveal (renders children).
Do not restyle pages yet.
```
**אימות:** טסטים ירוקים. אפשר ליצור דף זמני `/ui-kit` להצגה ולמחוק אחרי (לא לעשות קומיט עליו).

---

## שלב 5 — לוקליזציה של מחרוזות קיימות

**Prompt:**
```
Using the list from step 0, move user-visible strings to the dictionaries.
- gate/messages.ts: DENIAL_TEXT stays exported for tests, but add a function
  denialText(lang, reason) backed by the dictionaries.
- DashboardPage PILL and chartMath REASON_LABEL: add translated variants via keys.
- Pages: Events, MyTickets, Enroll, Login, Register, Gate setup, Admin layout nav.
Hebrew texts should be natural, short UI Hebrew (not literal).
Rule: with lang=en every string must be byte-identical to today's, so existing tests
pass unchanged. Add a test that en and he have exactly the same set of keys.
```
**אימות:** טסט "אותם מפתחות" עובר. עוברים ידנית על כל המסכים בעברית ומחפשים טקסט באנגלית שנשאר, ושבירות של פריסה ב-RTL.

---

## שלב 6 — דף נחיתה "וואו"

**מטרה:** להחליף את `Home` החד-שורתי. ההתרשמות הראשונה.

**Prompt:**
```
Replace Home with a landing page (frontend/src/pages/landing/LandingPage.tsx).
Light theme, but with one dramatic dark hero band. Sections:
1. Hero: headline "Your face is your ticket" (translated), subtitle, two CTAs whose
   target depends on role: guests -> Register / Log in; USER -> My tickets; GATEKEEPER
   -> Gate; ADMIN -> Dashboard. Animated background: soft gradient mesh + a pure-CSS
   scanning face outline (SVG) with a moving scan line and corner brackets.
2. "How it works" in 3 steps (Buy ticket -> Enroll your face -> Walk through the gate)
   with icons (inline SVG) and Reveal animation.
3. A stats strip with CountUp numbers (static marketing numbers, clearly not live).
4. Footer with the language toggle.
Fully responsive (mobile first), RTL-safe with logical utilities. No images from
external hosts. Add tests: renders the correct CTA per role; en text unchanged.
```
**אימות:** פותחים במובייל ובדסקטופ, בעברית ובאנגלית. 5 שניות ראשונות: מבינים מה המוצר? הטסטים ירוקים.

---

## שלב 7 — דמו שער חי בתוך דף הנחיתה

**מטרה:** ה"וואו" המהיר: מבקר רואה את הקסם בלי להירשם.

**Prompt:**
```
Add a <GateDemo/> section to the landing page: a dark "mini gate" card that loops a
simulated scenario with timers only (NO camera, NO backend calls):
watching -> scanning (scan line) -> verifying -> APPROVED (green burst, check icon,
name) -> pause -> watching -> DENIED (red, reason) -> loop.
Reuse the visual components of the real gate overlay (extract shared presentational
pieces if needed, without touching useGateScanner). Add a "Try the real gate" button
for GATEKEEPER/ADMIN. Pause the loop when the card is offscreen or on reduced motion
(show a static approved state). Clean up timers on unmount. Test with fake timers:
the demo cycles states and clears timers.
```
**אימות:** בדף נחיתה ללא התחברות רואים את הלולאה. בטסט, אין אזהרות על timers שלא נוקו.

---

## שלב 8 — מסוף שער משודרג

**לא נוגעים ב-`useGateScanner`.** רק ב-`GatePage`, `ResultOverlay` וב-`Camera` (ילדים/overlay).

**Prompt:**
```
Upgrade the gate terminal (GatePage.tsx, Camera overlay) with the `.theme-dark` scope:
1. Control-room layout: header with event name, gate name, live clock, a status chip
   ("Watching" / "Verifying" / "Paused" / "Provider down") bound to ScannerState.phase.
2. Camera: rounded frame with animated corner brackets and a scan line while
   phase is "verifying"; a subtle pulse ring while "watching". Passed as children to
   <Camera>, no change to its API.
3. ResultOverlay: dramatic. Approved = emerald radial burst + large animated check
   (SVG stroke-dash draw) + user name big; Denied = rose with a short shake and the
   translated reason via denialText(). Keep the 3000 ms hold timing as is.
   Keep the current sounds (playApproved / playDenied).
4. A small session counter at the bottom: approved / denied since page opened
   (local state only).
5. All strings through t(). RTL-safe.
Keep the `scannerOptions` prop and existing gate.test.tsx assertions passing.
```
**אימות:** מריצים את זרימת הדמו מה-README (שלושה חלונות, `FACE_PROVIDER=demo`): אישור וסירוב נראים דרמטיים; הטסטים של השער ירוקים.

---

## שלב 9 — דשבורד חי משודרג

> **אוחד לתוך שלב 18. לא לבצע בנפרד.** נשאר כאן לעיון בלבד.

**לא נוגעים ב-`useAdminFeed`.**

**Prompt:**
```
Upgrade the admin DashboardPage with `.theme-dark`:
1. Header row with a "LIVE" indicator bound to useAdminFeed status
   (live = pulsing green dot, reconnecting = amber, connecting = grey,
   unauthorized = red) with translated labels.
2. StatTile: use CountUp, larger numerals, subtle gradient border; keep the same props.
3. Replace the occupancy Meter with a circular SVG gauge (stroke-dasharray animated).
   If the Meter is used elsewhere, keep it and add the gauge as a new component.
4. LiveFeed: new events slide in at the top (CSS animation on the newest <li> only,
   keyed by event id), approved/denied get a colored edge and icon; flash highlight
   for 1.5 s. Denied reason translated via the dictionaries.
5. Charts: recolor to the dark palette via CHART_COLORS; keep chartMath logic intact.
6. AdminLayout nav: dark sidebar, icons, active state, collapses to a top bar on mobile.
Keep dashboard.test.tsx green. Add a test that a newly pushed event appears first.
```
**אימות:** פותחים את הדשבורד לצד מסוף השער, סורקים: האירוע קופץ בדשבורד תוך שניות עם אנימציה. טסטים ירוקים.

---

## שלב 10 — ליטוש שאר המסכים

> **אוחד לתוך שלבים 19 (הכרטיסים שלי) ו-21 (שאר המסכים). לא לבצע בנפרד.** נשאר כאן לעיון בלבד.

**Prompt:**
```
Restyle the remaining pages with the new Card/Button/Badge components, light theme:
Events (cards with date and status badge), My tickets (ticket-like card with a cut-out
look and QR area), Enroll (clear steps with a face-guide frame over the camera),
Login/Register (centered card, nice focus states), checkout success/cancel
(celebratory vs neutral), and NotFound. Do not change behavior or routes.
Keep all existing tests passing; update test queries only if a role/label legitimately
changed, and tell me before doing so.
```
**אימות:** עוברים על כל התהליך כמשתמש: הרשמה → אירוע → תשלום → סריקה. הכול עקבי חזותית, בשתי השפות.

---

## שלב 11 — בדיקות סופיות, נגישות ותסריט הדגמה

**Prompt:**
```
Final pass:
1. Run all frontend tests, the build and the linter. Run Lighthouse or equivalent
   checks if available and report accessibility issues on landing, gate, dashboard.
2. Verify no CSP violations in the browser console when running via Docker Compose
   (nginx, HTTPS). Fonts must load from 'self'.
3. Verify prefers-reduced-motion: all looping animations stop.
4. Verify RTL: no overflowing or mirrored-wrong icons (arrows/chevrons must flip).
5. Update README: a "UI" section (themes, i18n how-to-add-a-key, fonts location and
   license notes) and a 90-second demo script.
Report a checklist with pass/fail. Do not fix without asking if it is more than 20 lines.
```
**אימות:** הצ'קליסט ירוק. אז קומיט סופי ו-PR.

---

## תסריט הדגמה של 90 שניות (למצגת)

1. **0:00** דף הנחיתה באנגלית. הסריקה המונפשת רצה. "הפנים שלך הן הכרטיס".
2. **0:15** מחליפים לעברית: הכול מתהפך ל-RTL בלחיצה אחת. (רגע ה"וואו" הראשון.)
3. **0:25** גוללים: דמו השער החי בלולאה, אישור ירוק וסירוב אדום.
4. **0:40** מסוף שער אמיתי (כהה) בחלון אחד, דשבורד בחלון שני, זה לצד זה.
5. **0:50** עומדים מול המצלמה: האישור נפתח במסוף, ובדשבורד האירוע קופץ מיד, המונה עולה, האכלוס מתעדכן. (רגע ה"וואו" השני.)
6. **1:10** אדם לא רשום מגיע: סירוב אדום עם סיבה, ובדשבורד נרשם עם הסיבה.
7. **1:25** סיום: "בלי כרטיס נייר, בלי תור, בזמן אמת."

## הכנה לפני ההצגה

- `FACE_PROVIDER=demo` ו-`PAYMENT_PROVIDER=fake`, כדי שלא תהיה תלות באינטרנט. **שימו לב:** כרגע ב-`.env` מוגדר `PAYMENT_PROVIDER=stripe`, צריך להחליף לפני ההצגה (ולהפעיל מחדש את ה-backend).
- אירוע פעיל ומשתמש אחד עם כרטיס שנרשם (enrolled) מראש.
- שני חלונות דפדפן מוכנים והרשאת מצלמה כבר ניתנה.
- שפה: ללמוד את התסריט פעם אחת בכל שפה.


---
---

# חלק ב' — תיקוני UI אחרי הבדיקה הראשונית

> נוסף ב-11.10.2026 לפי משוב: טופס תאריכים שבור, מיקום לא מאומת, אין אייקון, מסכים לא אינטראקטיביים, טבלת לוגים לא מסודרת, דשבורד עם פגמי תצוגה, "הכרטיסים שלי" לא מסונכרן עם סטטוס האירוע, ואין ולידציית תמונה.

## ממצאים מהקוד (מה באמת קורה היום)

| בעיה | מה נמצא בקוד | המשמעות |
|---|---|---|
| תאריכים | `EventsAdminPage` ו-`LogsPage` משתמשים ב-`<input type="datetime-local">` גולמי. `fromLocalInput` קורא `new Date(value).toISOString()` שזורק `RangeError` על ערך ריק או חלקי. אין בדיקת "סיום אחרי התחלה", "לא בעבר", ואין `min`. | תצוגה שונה בכל דפדפן, שבירה ב-RTL, וקריסה אפשרית |
| מיקום | `location` הוא טקסט חופשי (`min_length=1`) גם ב-frontend וגם ב-backend. | אפשר לכתוב "asdf" |
| אייקון | ב-`frontend/index.html` אין `<link rel="icon">`, ואין תיקיית `public/`. | אייקון ברירת מחדל של הדפדפן |
| הכרטיסים שלי | הטיפוס `MyTicket.event` כולל רק `id, name, location, starts_at, ends_at`, **בלי `status`** של האירוע. `sortTickets` מבדיל עבר/עתיד, אבל התצוגה מציגה רק את סטטוס הכרטיס. | כרטיס `VALID` של אירוע שנסגר או נגמר עדיין נראה תקף, עם QR וכפתור הרשמת פנים |
| תמונה | ה-backend **כן** מאמת איכות (`check_quality`, שגיאת 422 עם `issues`), וה-frontend מציג טיפים. ב-`.env` מוגדר כבר `FACE_PROVIDER=demo`, וה-provider הזה בודק רק בהירות, חדות וגודל: **אין ספירת פנים ואין זיהוי שיש פנים בכלל**. אין שום בדיקה בצד הלקוח לפני ההעלאה. | תמונה ברורה של קיר או של שני אנשים עוברת. זו הסיבה שנראה שאין ולידציה |

הערה כנה: לא ראיתי את המסכים רצים, אלא רק את הקוד. את פגמי התצוגה בדשבורד ובלוגים ספציפית צריך לזהות בשלב 12 לפי צילומי מסך.

## סדר מומלץ

`7 → 8 → 12 → 13 → 14 → 15 → 16 → 19 → 20 → 17 → 18 → 21 → 11 (בדיקות סופיות)`

הסיבה: 7–8 (דמו שער ומסוף שער) לא חופפים לחלק ב', אז מסיימים אותם קודם. 14 (ערכת האינטראקציה) נדרשת בכמה שלבים אחרי. 19 כולל שינוי backend, כדאי לעשות אותו מוקדם.

**איחודים (כדי לא לעצב אותו מסך פעמיים):**
- **שלב 9 → שלב 18.** שניהם על הדשבורד. כל הסעיפים של שלב 9 נוספו ל-Prompt של שלב 18.
- **שלב 10 → שלבים 19 ו-21.** עיצוב "הכרטיסים שלי" כבר בשלב 19. שאר המסכים (Events, Enroll, Login/Register, Checkout, NotFound) נוספו לשלב 21.

---

## שלב 12 — ביקורת חזותית מבוססת צילומי מסך

**מטרה:** לא לנחש מה "שבור" בדשבורד ובלוגים.

**מה אתה עושה:** מריץ את המערכת עם נתוני דמו (לפחות 30 רשומות לוג, 2–3 אירועים), ומצלם מסך של: דשבורד, לוגים, אירועים (אדמין), הכרטיסים שלי, בשלושה רוחבים (מובייל 390px, טאבלט 820px, דסקטופ 1440px). מדביק את התמונות ל-Claude Code.

**Prompt:**
```
I'm attaching screenshots of the dashboard, logs table, admin events and my-tickets
at 390 / 820 / 1440 px. Do not change code. For each screen list every visual defect
you can see (overflow, clipped labels, misaligned columns, inconsistent spacing,
unreadable contrast, charts with overlapping labels, numbers not formatted, empty
states). Output a table: screen | width | defect | likely cause in the code
(file + line) | proposed fix | effort (S/M/L). Group by severity.
```
**אימות:** הטבלה מכסה את מה שאתה רואה בעצמך. תוסיף ידנית כל פגם שהוא פספס. הטבלה הזו היא רשימת העבודה לשלבים 17–18.

---

## שלב 13 — אייקון ומטא-תגיות ב-`index.html`

**Prompt:**
```
Add a favicon and head metadata to frontend/index.html. Constraints: nginx CSP is
default-src 'self' and script-src 'self', so no inline scripts and no external URLs.
1. Create frontend/public/ with:
   - favicon.svg (a simple face-scan mark: rounded square, indigo->cyan gradient, white
     face outline with corner brackets; must stay readable at 16px)
   - apple-touch-icon.png (180x180) and icon-192.png / icon-512.png (generate from the
     SVG with a one-off script; do NOT add a dependency, use what's installed or ask me)
   - site.webmanifest (name, short_name, theme_color, background_color, icons)
2. In index.html <head>: link rel=icon (svg + a 32x32 png fallback), apple-touch-icon,
   manifest, meta description, meta theme-color (with a dark variant via media),
   meta color-scheme, og:title / og:description / og:type, twitter:card summary.
3. Keep <html lang="en">: the i18n provider (step 2) updates lang/dir at runtime.
4. Check the nginx config serves /favicon.svg and /site.webmanifest with correct
   MIME types and without breaking the SPA fallback; fix if needed.
```
**אימות:** האייקון מופיע בלשונית (כולל רענון קשיח, Ctrl+Shift+R). `npm run build` מעתיק את `public/` ל-`dist`. אין שגיאות CSP בקונסול.

---

## שלב 14 — ערכת אינטראקציה משותפת

**מטרה:** שהמסכים "ירגישו חיים", עם כמה רכיבים שחוזרים בכל מקום.

**Prompt:**
```
In frontend/src/components/ui/ (create if missing) add, typed and tested, no new deps:
- Toast system: ToastProvider + useToast() with success/error/info, auto-dismiss,
  aria-live="polite", stacks bottom-end (RTL-safe), pauses on hover.
- ConfirmDialog (accessible modal: focus trap, Esc closes, returns focus, backdrop click)
  used instead of silent destructive actions.
- Skeleton (shimmer) for lists, tables and stat tiles; replace plain Spinner on
  list-type pages only. Keep Spinner for buttons.
- EmptyState (inline SVG illustration, title, hint, optional action button).
- Tooltip (hover + focus, no external lib).
- Button: add loading state (spinner + disabled + aria-busy) and press feedback.
- Route transition: a short fade/slide on route change (CSS only), disabled under
  prefers-reduced-motion.
All strings through t(). Tests: Toast appears and dismisses (fake timers), ConfirmDialog
traps focus and calls the right callback, Skeleton renders.
Do not apply them to pages yet.
```
**אימות:** טסטים ירוקים. הרכיבים עובדים במקלדת בלבד (Tab, Esc, Enter).

---

## שלב 15 — בורר תאריך ושעה אמיתי + ולידציה

**מטרה:** לתקן את קלט התאריכים לחלוטין.

**Prompt:**
```
Replace every <input type="datetime-local"> (EventsAdminPage form, LogsPage From/To)
with a hand-built DateTimeField component in components/ui/DateTimeField.tsx.
Requirements:
1. Calendar popover (month grid, prev/next, "Today"), plus a time field with 5-minute
   steps and typing support. Week starts Sunday in both languages (Israeli and en-US
   convention); keep it as one named constant so it is easy to change.
   Full keyboard support (arrows, PageUp/PageDown, Enter, Esc). aria-labelled.
   RTL-correct, localized month/day names via Intl.DateTimeFormat (no library).
2. Props: value (ISO string or null), onChange, min?, max?, label, error?.
   It owns parsing: invalid or partial input never reaches fromLocalInput.
3. Make fromLocalInput safe: return null for invalid input instead of throwing
   (update its callers and its tests).
4. Event form rules, shown inline under the fields, not only after submit:
   - start must not be in the past when creating, with a 5-minute grace window so
     an event starting "now" (needed for the live demo) is accepted; the check runs
     against the current time at submit, not at page load (editing an existing past
     event is allowed to keep its dates),
   - end must be after start (matches the DB check ck_events_ends_after_starts),
   - quick duration chips after choosing start: 1h, 2h, 3h, All day,
   - show the viewer's time zone name next to the field.
5. Logs filter: From must be before To (keep the existing message), add presets:
   Today / Last 24h / Last 7 days.
Keep the stored value as UTC ISO. Add tests: month navigation, keyboard selection,
min/max disabling, invalid typed text, end-before-start message, start 2 minutes ago
accepted / 10 minutes ago rejected, Sunday as first day in both languages.
Update events.test.tsx / adminTables.test.tsx only where the control legitimately
changed, and tell me which assertions you changed.
```
**אימות:** יוצרים אירוע עם תאריך בעבר: נחסם. סיום לפני התחלה: הודעה מיידית. ב-Chrome וב-Firefox נראה ומתנהג אותו דבר. בעברית הלוח מתהפך ושמות החודשים בעברית.

---

## שלב 16 — מיקום אמיתי: בורר עיר עם השלמה אוטומטית

**החלטה לפני שמתחילים (Claude Code ישאל אותך):**
- **א׳ (מומלץ להצגה):** רשימת ערים מובנית בריפו (ישראל מלאה + כ-150 ערים בעולם), בלי API חיצוני. מהיר, עובד אופליין, עובד עם ה-CSP.
- **ב׳:** חיפוש כתובות אמיתי דרך ה-backend מול OpenStreetMap Nominatim. נותן "וואו" (גם רחוב ומקום), אבל זו תלות חיצונית שדורשת הגבלת קצב ו-User-Agent, ושינוי ב-backend.
- אפשר להתחיל ב-א׳ ולהוסיף ב׳ אחר כך.

**Prompt (אפשרות א׳):**
```
Make Location real. Model: `location` stays a single string "Venue, City" so no
migration is needed.
1. Add frontend/src/data/cities.ts: Israeli cities (he + en names, ~100 incl. major
   localities) and ~150 major world cities (en name + country). Source them carefully
   and tell me where the data came from. Keep the file < 60KB.
2. Build CityCombobox (ARIA combobox pattern): type to filter, diacritic- and
   case-insensitive, matches Hebrew and English, arrows/Enter to pick, shows a
   country hint, "No match" state. Selection is required: free text that isn't a
   listed city is invalid.
3. Event form: two fields, "Venue" (free text, required, max 100) and "City"
   (combobox). Compose location as `${venue}, ${city}`. When editing an existing
   event, parse the last ", " segment as the city; if it doesn't match the list, show
   the city field empty with a gentle "please choose a city" and keep the old value
   until changed.
4. Backend (ask me before starting): add a validator that the location contains a
   comma and a non-empty city part (cheap server-side guard so the API can't be used to
   bypass the UI). Apply it on EventCreate always, but on update ONLY when the location
   value actually changes (compare to the stored value in the service, not in the
   schema), so legacy events like "Here" can still be edited without touching the
   location. The frontend must not resend an unchanged legacy location as a change.
   Update existing callers in the same step: backend tests that create events with
   comma-less locations (e.g. "Here", "Tel Aviv" in tests/integration/
   test_gate_concurrency.py, test_ticket_concurrency.py, tests/unit/
   test_notification_service.py, and any others you find with grep) and
   backend/scripts/measure_latency.py. Tests that bypass the schema (ORM objects)
   may keep their values; list which files you changed and why.
   Add tests: create without comma -> 422, update of a legacy event without changing
   location -> 200, update changing location to "asdf" -> 422.
   Do not add a city list to the backend.
5. Event cards (user Events page and My tickets) show the city with a map-pin icon.
Tests: filtering (he/en), keyboard selection, invalid city blocks submit, composed
value is right.
```
**אימות:** מקלידים "תל" ומקבלים תל אביב; "Jerus" מקבל Jerusalem; "asdf" לא נשמר. API ישיר עם `location="asdf"` מחזיר 422. עריכת אירוע ישן (מיקום בלי פסיק) בלי לשנות מיקום נשמרת. `pytest` כולו ירוק.

---

## שלב 19 — "הכרטיסים שלי": עיצוב מסודר + סנכרון סטטוס האירוע

**זה שלב עם שינוי backend, לכן Claude Code ישאל אישור (CLAUDE.md).** השלב כולל גם את עיצוב "הכרטיסים שלי" משלב 10 (כרטיס בסגנון ספח עם אזור QR, סעיף 3).

**Prompt:**
```
Fix My tickets so the card reflects the event, not just the ticket.
BACKEND (small, ask me before starting):
- Add `status` (EventStatus) to the event object nested in MyTicket
  (schema + service + tests). No migration: it's a read model change.
FRONTEND:
1. Add a pure function `effectiveState(ticket, now)` returning one of:
   UPCOMING | LIVE_NOW | ENDED | EVENT_CLOSED | USED | CANCELLED | AWAITING_PAYMENT.
   Rules: ticket CANCELLED -> CANCELLED; ENTERED -> USED; event.status CLOSED ->
   EVENT_CLOSED (even if dates are in the future); now >= ends_at -> ENDED;
   starts_at <= now < ends_at and VALID -> LIVE_NOW; PENDING_PAYMENT stays
   AWAITING_PAYMENT unless the event is ended/closed, in which case show "Event
   unavailable" and hide the pay button.
   Unit-test every branch, including boundaries (now == starts_at, now == ends_at).
2. Card behavior by state:
   - UPCOMING/LIVE_NOW (VALID): QR + "Set up face entry" as today; LIVE_NOW gets a
     pulsing "Happening now" badge; UPCOMING shows a live countdown ("in 2d 4h").
   - ENDED / EVENT_CLOSED / USED / CANCELLED: no QR, no enroll link, muted style,
     clear label ("Event ended", "Event closed by organizer", "Used", "Cancelled").
3. Layout: group into sections "Upcoming" and "Past" (collapsed by default, with
   count), ticket-stub design (dashed divider, notch cutouts, date block on the
   start side, QR on the end side), responsive single column on mobile.
   Tapping the QR opens it large in a dialog (ConfirmDialog/Modal from step 14).
4. Recompute `now` every 30 s so a card flips to ENDED without a reload.
5. Strings via t(); keep English strings of existing statuses identical so
   tickets.test.tsx keeps passing; add tests for new states.
```
**אימות:** יוצרים אירוע, קונים כרטיס, סוגרים את האירוע כאדמין (`Close`): הכרטיס עובר מיד ל"Event closed" ללא QR. אירוע שתאריך הסיום שלו עבר: "Event ended". הטסטים של ה-backend (541) והפרונט ירוקים.

---

## שלב 20 — ולידציית תמונה בצילום פנים

**מטרה:** משוב מיידי לפני ההעלאה, בלי תלות ב-provider ובלי ספריה חדשה.

**רקע:** ב-`.env` כבר מוגדר `FACE_PROVIDER=demo`. הוא בודק בהירות, חדות וגודל, אבל לא אם יש פנים בתמונה ולא כמה. לכן החלק החשוב בשלב הזה הוא סעיף 2 (FaceDetector) והצ'קליסט בסקירה. `rekognition` יבדוק פנים באמת, אבל רק אם יש חשבון AWS.

**Prompt:**
```
Add client-side photo validation to the enrollment flow (EnrollPage.tsx), with zero
new dependencies.
1. frontend/src/enroll/photoChecks.ts: pure functions on a canvas/ImageData:
   - brightness (mean luminance) -> TOO_DARK / TOO_BRIGHT,
   - sharpness (variance of a Laplacian on a downscaled grayscale) -> BLURRY,
   - resolution (min side) -> TOO_SMALL.
   Thresholds as named constants with comments. Unit-test with synthetic ImageData
   (black image, white noise, gradient, blurred vs sharp).
2. Optional progressive enhancement: if `window.FaceDetector` exists (Chromium
   Shape Detection API), count faces and check the face box is centered and covers
   at least ~25% of the frame height -> NO_FACE / MULTIPLE_FACES / TOO_SMALL /
   BAD_POSE hints. If unavailable, skip silently. Tell me the browser support status
   you verified. Do NOT add MediaPipe/face-api without asking me.
3. Live feedback in CaptureStep: every ~400 ms sample the video and show a status
   chip under the oval (green "Looking good" / amber hint with the specific tip,
   translated). The oval border turns green only when all checks pass. The
   "Take photo" button stays enabled but shows a confirmation ("This photo may be
   rejected. Take it anyway?") when checks fail; it is advisory, the server remains
   the authority.
4. After capture, run the same checks on the still. In Review, show the result as
   a checklist (Lighting / Sharpness / Size / Face) with ✓ or ✕, and disable
   "Use this photo" with an explanation when a hard failure exists (too dark, blurry,
   too small), with a one-click "Retake".
5. Reuse QUALITY_TIPS for text; add client-only tips (TOO_BRIGHT). Translate all.
6. Keep server 422 handling exactly as is; keep enroll.test.tsx passing; add tests
   for: hard failure blocks upload, soft warning allows with confirm, FaceDetector
   absent does not crash, server 422 still shows tips.
Privacy: samples stay in memory; nothing is uploaded or stored by these checks.
```
**אימות:** מכסים את המצלמה: "Too dark" בזמן אמת. מטשטשים (מזיזים את המצלמה): "Blurry". תמונה תקינה: ירוק, והעלאה עוברת. הטסטים הישנים של `enroll` עוברים.

---

## שלב 17 — טבלת הלוגים: עיצוב מסודר

(מבוסס על הטבלה בשלב 12, אז קודם בצע אותו.)

**Prompt:**
```
Redesign LogsPage using the defect list from step 12 and this brief. Keep
filtersFromParams and the URL-as-source-of-truth behavior untouched.
1. Filters: a tidy responsive grid in a Card (not a loose flex row). Active filters
   shown as removable chips with a result count ("128 entries"). "Clear filters"
   appears only when something is active. Date range uses DateTimeField (step 15).
2. Table: fixed column widths via table-fixed and a colgroup; sticky header; zebra
   or subtle row separators; numeric columns end-aligned with tabular-nums;
   long text truncates with a tooltip; consistent paddings; start-aligned text using
   logical utilities so RTL works (replace text-left / text-right).
3. Cells: Result as a Badge (✓/✕ with color), Method as a small pill (face/QR icon),
   Reason as muted text with translated labels, Time as relative ("3 min ago") with the
   absolute time in a Tooltip, Similarity as a thin bar plus the number, Gate in
   monospace.
4. Row click opens a side drawer with full details (timestamp, event, gate, method,
   result, reason, holder, similarity) and Esc/close handling.
5. Mobile (<640px): replace the table with stacked cards.
6. Loading: Skeleton rows. Empty: EmptyState with "Clear filters" action.
7. "Export CSV" of the current filtered page, generated client-side (escape quotes,
   commas and newlines; prefix cells starting with = + - @ with a quote to prevent
   CSV injection). Test the escaping.
8. Pagination: show "1–50 of 128", prev/next with disabled states, keyboard support.
Keep adminTables.test.tsx green; tell me about any assertion you must change.
```
**אימות:** הטבלה נראית מיושרת ב-3 הרוחבים מצילומי שלב 12. הפילטרים נשמרים ב-URL. CSV נפתח באקסל בעברית (הוסף BOM בתחילת הקובץ, ובדוק).

---

## שלב 18 — דשבורד: תיקון הצגת נתונים

(מבוסס על הטבלה בשלב 12. הרשימה הבאה היא מה שנהוג לתקן, ו-Claude Code יתאים אותה למה שמצא.)

**Prompt:**
```
Fix the dashboard data presentation using the defect list from step 12. Do not change
useAdminFeed or backend calls. Checklist to apply where the audit confirms it:
1. Number formatting: Intl.NumberFormat per language for all counts, percentages and
   currency; never show raw floats; consistent decimals; "—" for no data.
2. Zero/empty/loading states for each widget (Skeleton while loading, EmptyState
   with a hint when there is no data, never an empty frame or NaN%).
3. Charts: ColumnChart and BarList labels must not overlap or clip: truncate with
   tooltip, rotate or thin out x labels via the existing labelIndices, make the SVG/
   container responsive (viewBox, no fixed pixel widths), tooltips on hover/focus
   showing exact values, y-axis ticks from niceMax with formatted numbers, colors
   from CHART_COLORS with sufficient contrast on the dark theme, and a text
   alternative (aria-label / visually hidden summary).
4. StatTile: consistent height, number never wraps or overflows (clamp font size),
   unit and delta in separate elements, optional trend arrow.
5. Layout: CSS grid with defined breakpoints (1 / 2 / 4 columns), equal gaps, no
   horizontal scroll at 390px; live feed has a max-height with internal scroll and a
   "pause updates" toggle.
6. RTL: charts keep time flowing in a sensible direction for Hebrew (decide and
   document: time axis stays LTR is acceptable; labels must still be right-aligned).
7. Time bucket labels formatted via Intl per language.
8. Visual upgrade (merged from step 9), dark control-room theme `.theme-dark`:
   - header row with a "LIVE" indicator bound to useAdminFeed status (live = pulsing
     green dot, reconnecting = amber, connecting = grey, unauthorized = red),
     translated labels;
   - StatTile uses CountUp with larger numerals and a subtle gradient border; keep
     the same props;
   - replace the occupancy Meter with a circular SVG gauge (animated
     stroke-dasharray); if Meter is used elsewhere keep it and add the gauge as a new
     component;
   - LiveFeed: newest item slides in at the top (CSS animation on the newest <li>
     only, keyed by event id), approved/denied get a colored edge and icon, flash
     highlight for 1.5 s, denied reason translated;
   - charts recolored to the dark palette via CHART_COLORS; keep chartMath intact;
   - AdminLayout nav: dark sidebar with icons and active state, collapses to a top
     bar on mobile.
Keep dashboard.test.tsx green and add tests for: empty data, zero capacity (no
division by zero), a very long event name, large numbers (e.g. 12,345), and a newly
pushed event appearing first in the feed.
```
**אימות:** מרכיבים נתוני דמו קיצוניים (0 נתונים; שם אירוע ארוך מאוד; 10,000 כניסות) ומוודאים שאין חריגה, חיתוך או NaN. בדיקה ב-390px. בנוסף (משלב 9): פותחים את הדשבורד לצד מסוף השער וסורקים. האירוע קופץ בדשבורד תוך שניות עם אנימציה.

> השלב הזה גדול (איחוד של 9 ו-18). אם התוכנית ש-Claude Code מציג ארוכה מדי, מפצלים לשני קומיטים: 18א (תיקוני נתונים, סעיפים 1–7) ו-18ב (שדרוג חזותי, סעיף 8).

---

## שלב 21 — מעבר אינטראקטיביות על שאר המסכים

**Prompt:**
```
Apply the interaction kit (step 14) across the non-landing pages. Do not change
behavior or routes; keep tests green (tell me if an assertion must change).
- Events (user): card hover lift, skeleton loading, "Sold out" / "Ended" /
  "Few left" badges computed from capacity and dates, filter chips (All / This
  week / Free), animated price/availability, buy button loading state, Toast on
  success/failure instead of only inline text where appropriate.
- Admin Events: ConfirmDialog for Close and Delete (state the consequence), Toast
  after each action, inline status badges, row expand for details, optimistic UI
  with rollback on failure, cover-image drag-and-drop with preview and size/type
  validation message.
- Admin Users: debounced search box, sortable columns (aria-sort), role badges,
  confirm before role/status changes, Skeleton + EmptyState.
- Settings: dirty-state tracking, "Unsaved changes" bar with Save/Discard, Toast on save.
- Login/Register: show/hide password, live password-strength meter on Register,
  inline field validation on blur, shake on failed login, autofocus first field.
- Checkout success/cancel: celebratory CSS-only confetti (reduced-motion safe)
  on success, clear next actions on cancel.
- Enroll: a step indicator (Consent -> Photo -> Review -> Done) with progress, and a
  face-guide frame over the camera (keep step 20's oval/status chip; don't duplicate).
- Restyle (merged from step 10), light theme, using Card/Button/Badge: Events as
  cards with a date block and status badge; Login/Register as a centered card with
  clear focus states; checkout success (celebratory) vs cancel (neutral); NotFound
  page with a friendly message and a way home. My tickets is already done in step 19.
- Global: visible focus rings, hover and active states on every control, 44px touch
  targets on mobile.
```
**אימות:** עוברים על כל מסך כמשתמש ואדמין. כל פעולה הרסנית מבקשת אישור; כל פעולה מסתיימת בהודעה. הכול עובד גם במקלדת. בנוסף (משלב 10): עוברים על כל התהליך כמשתמש (הרשמה → אירוע → תשלום → סריקה). הכול עקבי חזותית, בשתי השפות.

> גם השלב הזה גדול. אם צריך, מפצלים לקומיט לכל קבוצת מסכים (משתמש / אדמין / אימות ותשלום).

---

## עדכון לתסריט ההדגמה (90 שניות)

הוסף אחרי הדקה הראשונה, אם יש זמן:
- **יצירת אירוע:** בוחרים תאריך בלוח, עיר עם השלמה אוטומטית ("תל" ← תל אביב), ושגיאה מיידית כשהסיום לפני ההתחלה.
- **צילום פנים עם משוב חי:** מכסים את המצלמה ← "חשוך מדי", מגלים ← ירוק ← "Use this photo".
- **הכרטיסים שלי:** סוגרים אירוע בלשונית האדמין ורואים את הכרטיס מתעדכן ל"Event closed".