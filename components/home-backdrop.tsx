"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

// React Bits Pro "Flicker". Fetched at build time (scripts/fetch-react-bits.mjs),
// never committed. A build without the licence key gets a stub that renders
// nothing, and the CSS background underneath is what shows.
const Flicker = dynamic(() => import("@/components/react-bits/flicker"), { ssr: false });

const TOKENS = ["--cell-2", "--cell-3", "--accent"];

/** The landing page's moving background: a fixed grid of dots that twinkle and
 *  brighten near the pointer. Decorative, so it waits for the browser to be
 *  idle and never mounts for a visitor who asked for reduced motion. */
export function HomeBackdrop() {
  const ref = useRef<HTMLDivElement>(null);
  const [palette, setPalette] = useState<string[] | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // The dots take the theme's own colours, and follow it when it changes.
    const read = () => {
      const css = getComputedStyle(document.documentElement);
      setPalette(TOKENS.map((t) => css.getPropertyValue(t).trim()));
    };
    const start = window.setTimeout(read, 300);
    const themeAttr = new MutationObserver(read);
    themeAttr.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", read);

    // The canvas sits behind the page, so it never sees the pointer itself.
    const move = (e: MouseEvent) =>
      ref.current?.firstElementChild?.dispatchEvent(
        new MouseEvent("mousemove", { clientX: e.clientX, clientY: e.clientY }),
      );
    window.addEventListener("mousemove", move, { passive: true });

    return () => {
      window.clearTimeout(start);
      themeAttr.disconnect();
      scheme.removeEventListener("change", read);
      window.removeEventListener("mousemove", move);
    };
  }, []);

  return (
    <div ref={ref} className="home-bg" aria-hidden="true">
      {palette && (
        <Flicker
          spacing={26}
          particleSize={1.4}
          colorPalette={palette}
          glowColor={palette[2]}
          overlay={0}
          rate={0.55}
          flickerChance={0.45}
          mouseEffect
        />
      )}
    </div>
  );
}
