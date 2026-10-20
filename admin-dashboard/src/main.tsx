import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Applied before React mounts so the login page (rendered outside Layout,
// which is what actually owns the toggle) also respects a saved preference
// instead of flashing light mode first.
try {
  const stored = localStorage.getItem("theme");
  if (stored === "dark") document.documentElement.setAttribute("data-theme", "dark");
} catch {
  // localStorage unavailable -- defaults to light, same as a first visit.
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
