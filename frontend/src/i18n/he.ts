import type { TranslationKey } from "./en";

// Typed against the English keys: a missing translation is a compile error.
export const he: Record<TranslationKey, string> = {
  "app.name": "BioAccess",
  "nav.events": "אירועים",
  "nav.myTickets": "הכרטיסים שלי",
  "header.logIn": "התחברות",
  "header.register": "הרשמה",
  "header.logOut": "התנתקות",
  "lang.label": "שפה",
  "lang.en": "אנגלית",
  "lang.he": "עברית",
};
