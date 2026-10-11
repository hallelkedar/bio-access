// English is the source of truth: its keys define TranslationKey. Values must stay
// byte-identical to the UI text the tests expect.
export const en = {
  "app.name": "BioAccess",
  "nav.events": "Events",
  "nav.myTickets": "My tickets",
  "header.logIn": "Log in",
  "header.register": "Register",
  "header.logOut": "Log out",
  "role.USER": "Visitor",
  "role.GATEKEEPER": "Gatekeeper",
  "role.ADMIN": "Admin",
  "nav.main": "Main",
  "lang.label": "Language",
  "lang.en": "English",
  "lang.he": "Hebrew",
} as const;

export type TranslationKey = keyof typeof en;
