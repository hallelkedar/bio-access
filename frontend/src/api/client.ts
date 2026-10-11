import axios, { AxiosError } from "axios";

import { clearToken, getToken } from "../auth/tokenStore";

// Relative URLs: the Vite dev server (and later the production server) routes /api to the backend.
export const api = axios.create({ baseURL: "/", timeout: 15_000 });

let onUnauthorized: () => void = () => {};

/** Called after a 401 (expired or invalid token); the auth context sends the user to login. */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (error instanceof AxiosError && error.response?.status === 401) {
      clearToken();
      onUnauthorized();
    }
    return Promise.reject(error);
  },
);
