// The JWT lives in sessionStorage: cleared when the tab closes (good for shared gate laptops).
// Like localStorage it is readable by any script on the page, so XSS must be prevented
// (React escapes output; the backend sends a strict CSP). The rest of the app only uses
// these three functions, so the storage can be swapped in one place.
const KEY = "bioaccess.token";

export function getToken(): string | null {
  return sessionStorage.getItem(KEY);
}

export function setToken(token: string): void {
  sessionStorage.setItem(KEY, token);
}

export function clearToken(): void {
  sessionStorage.removeItem(KEY);
}
