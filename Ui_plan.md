# UI_PLAN.md — שדרוג ה-UI של BioAccess ל"וואו"

> קובץ הוראות ל-Claude Code. עובדים לפי `CLAUDE.md` של הריפו: קודם תוכנית, צעד אחד = קומיט אחד, לא עושים קומיט לפני שהאדם אישר, ולא מוסיפים תלות (dependency) בלי לשאול.

## החלטות שכבר התקבלו

| נושא | החלטה |
|---|---|
| היקף | שלושה מסכי וואו (דף נחיתה, מסוף שער, דשבורד חי) + מערכת עיצוב משותפת |
| כיוון חזותי | היברידי: האפליקציה בהירה, מסוף השער והדשבורד כהים כמו חדר בקרה |
| שפה | מתג עברית/אנגלית כתוב ידנית, בלי ספריית i18n, עם תמיכה ב-RTL |
| אנימציות | CSS בלבד (בלי framer-motion), עם כיבוד `prefers-reduced-motion` |

## חוקי ברזל (לקרוא לפני כל צעד)

1. **אין שבירת טסטים.** יש 142 טסטי פרונט שמצפים למחרוזות באנגלית. שפת ברירת המחדל נשארת `en`. טסט שצריך לעדכן = עוצרים ושואלים.
2. **CSP.** ב-`frontend/security-headers.conf` יש `style-src 'self'` ו-`script-src 'self'`. לכן: אין Google Fonts, אין CDN, אין `<style>` או `<script>` inline ב-HTML. פונטים נשמרים בריפו ונטענים מאותו origin. שימו לב: `style={{...}}` של React עובד (זה מאפיין DOM, לא inline של HTML שנטען), אבל לא להוסיף תגיות `<style>`.
3. **אין תלויות חדשות** בלי לשאול. מותר: CSS, SVG, Web Audio שכבר קיים, `requestAnimationFrame`.
4. **לא נוגעים בלוגיקה** של `useGateScanner`, `motion.ts`, `useAdminFeed`, ה-API וה-backend. משנים רק תצוגה, ועטיפות תצוגה.
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

- `FACE_PROVIDER=demo` ו-`PAYMENT_PROVIDER=fake`, כדי שלא תהיה תלות באינטרנט.
- אירוע פעיל ומשתמש אחד עם כרטיס שנרשם (enrolled) מראש.
- שני חלונות דפדפן מוכנים והרשאת מצלמה כבר ניתנה.
- שפה: ללמוד את התסריט פעם אחת בכל שפה.