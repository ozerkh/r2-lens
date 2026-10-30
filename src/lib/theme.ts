export type Theme = "light" | "dark";

const KEY = "r2-lens-theme";

export function storedTheme(): Theme {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {}
  if (saved === "light" || saved === "dark") return saved;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.mode = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {}
}
