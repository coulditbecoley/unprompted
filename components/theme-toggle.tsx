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
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      // Rendered but unlabelled until the effect resolves, so the markup is
      // identical on server and client and hydration stays quiet.
      suppressHydrationWarning
    >
      {/* An icon, not a word: "LIGHT" never fitted the 34px button and spilled
          over the page edge. The aria-label carries the words. */}
      {theme === null ? null : theme === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
        </svg>
      )}
    </button>
  );
}
