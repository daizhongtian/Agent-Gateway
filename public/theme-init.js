"use strict";

(() => {
  try {
    const stored = localStorage.getItem("codex.theme");
    document.documentElement.dataset.theme = stored === "light" ? "light" : "dark";
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
})();
