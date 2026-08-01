import axios from "axios";

import i18n from "../i18n";

const api = axios.create({
  baseURL: "http://localhost:5000/api",

  withCredentials: true,
});

let accessToken = null;

export const setAccessToken = (token) => {
  accessToken = token;
};

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }

  // Server-rendered content (loan product names/descriptions, FAQ text) is
  // localized by ?lang= — see finance-backend/src/utils/i18nContent.js, which
  // COALESCEs back to English per field when a translation is missing.
  //
  // Reads only: mutations carry their per-language fields explicitly in the
  // body, and tagging them with ?lang= would imply the write is scoped to one
  // language, which it isn't. English is the base column, so it needs no
  // param. An explicit params.lang from the caller always wins.
  const lang = i18n.resolvedLanguage;
  const method = (config.method || "get").toLowerCase();
  if (method === "get" && lang && lang !== "en") {
    config.params = { lang, ...config.params };
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,

  async (error) => {
    const originalRequest = error.config;

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url.includes("/auth/refresh")
    ) {
      originalRequest._retry = true;

      try {
        const res = await api.post("/auth/refresh");

        const token = res.data.accessToken;

        setAccessToken(token);

        originalRequest.headers.Authorization = `Bearer ${token}`;

        return api(originalRequest);
      } catch {
        setAccessToken(null);

        window.location.replace("/login");
      }
    }

    return Promise.reject(error);
  },
);

export default api;
