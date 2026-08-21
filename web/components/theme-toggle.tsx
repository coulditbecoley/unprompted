"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

/**
 * Neither theme is the default. The phone-in-a-dark-room scene argues for dark,
 * the screenshot-into-a-thread scene argues for light, and both are real, so the
 * system preference decides until a visitor says otherwise.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem("unprompted-theme");
    } catch {
      // Private modes throw on access. Fall through to the system preference.
    }
    if (stored === "dark" || stored === "light") {
      setTheme(stored);
      return;
    }
    setTheme(
      window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    );
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("unprompted-theme", next);
    } catch {
      // A viewer who blocks storage still gets the toggle for this session.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="theme-toggle mono"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      // Rendered but unlabelled until the effect resolves, so the markup is
      // identical on server and client and hydration stays quiet.
      suppressHydrationWarning
    >
      {theme === null ? "" : theme === "dark" ? "LIGHT" : "DARK"}
    </button>
  );
}
