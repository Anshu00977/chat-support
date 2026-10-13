import axios from "axios";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export const api = axios.create({ baseURL: `${API_URL}/api` });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("admin_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const isLoginRequest = err.config?.url?.includes("/auth/login");
    // A failed login attempt itself 401s -- that's not an expired session,
    // it's wrong credentials, and LoginPage already shows that inline. A
    // hard redirect here would wipe that error via a full page reload
    // before the user ever sees it.
    if (err.response?.status === 401 && !isLoginRequest) {
      localStorage.removeItem("admin_token");
      localStorage.removeItem("admin_user");
      if (location.pathname !== "/admin/login") location.href = "/admin/login";
    }
    return Promise.reject(err);
  }
);
