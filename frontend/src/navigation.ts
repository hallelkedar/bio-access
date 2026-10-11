/** Leave the app for an external page (the payment provider). Wrapped so tests can stub it. */
export function redirectTo(url: string): void {
  window.location.assign(url);
}
