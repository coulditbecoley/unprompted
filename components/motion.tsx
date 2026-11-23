"use client";

import { useEffect, useRef } from "react";

/* Our own motion pieces. No libraries and no licence: plain canvas and CSS.
   Standalone copies live in the vault under Web Designs/Website Assets. */

type DotFieldProps = {
  /** Pixels between dots. */
  gap?: number;
  /** Dot size in pixels. */
  size?: number;
  /** 1 is the default pace; 0.5 is half speed. */
  speed?: number;
  /** How far the pointer's light reaches, in pixels. */
  reach?: number;
  /** CSS custom properties read from the page for the dot and highlight colours. */
  tokens?: [dot: string, highlight: string];
};

/**
 * A fixed grid of dots behind the page. Each dot twinkles at its own pace, a
 * soft band of light crosses the grid every few seconds, and dots near the
 * pointer brighten. Decorative: it draws nothing for a visitor who asked for
 * reduced motion, and the CSS background underneath is what shows instead.
 */
export function DotField({ gap = 24, size = 1.6, speed = 1, reach = 170, tokens = ["--cell-3", "--accent"] }: DotFieldProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [dotToken, highlightToken] = tokens;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let w = 0, h = 0, cols = 0, rows = 0;
    let phase = new Float32Array(0), pace = new Float32Array(0);
    let dot = "#888", highlight = "#fff";
    let px = -9999, py = -9999;
    let frame = 0, last = 0;

    const colours = () => {
      const css = getComputedStyle(document.documentElement);
      dot = css.getPropertyValue(dotToken).trim() || dot;
      highlight = css.getPropertyValue(highlightToken).trim() || highlight;
    };

    const layout = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / gap) + 1;
      rows = Math.ceil(h / gap) + 1;
      phase = new Float32Array(cols * rows);
      pace = new Float32Array(cols * rows);
      for (let i = 0; i < phase.length; i++) {
        phase[i] = Math.random() * Math.PI * 2;
        // A third of the dots twinkle; the rest hold still so the grid stays calm.
        pace[i] = Math.random() < 0.34 ? 0.4 + Math.random() * 1.1 : 0;
      }
    };

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 32) return; // about 30 frames a second is plenty for a twinkle
      last = now;
      const t = (now / 1000) * speed;
      ctx.clearRect(0, 0, w, h);

      // The band of light: a diagonal line that crosses the screen, then rests.
      const span = w + h;
      const band = ((t * 0.09) % 1.6) * span - span * 0.3;

      for (let r = 0; r < rows; r++) {
        const y = r * gap;
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const x = c * gap;
          let a = 0.3;
          if (pace[i]) a += 0.3 * (0.5 + 0.5 * Math.sin(t * pace[i] + phase[i]));
          const fromBand = Math.abs(x + y - band);
          if (fromBand < 140) a += 0.4 * (1 - fromBand / 140);
          let lit = a > 0.62;
          const dx = x - px, dy = y - py;
          const d2 = dx * dx + dy * dy;
          if (d2 < reach * reach) {
            const near = 1 - Math.sqrt(d2) / reach;
            a += 0.75 * near;
            lit = lit || near > 0.25;
          }
          ctx.globalAlpha = a > 1 ? 1 : a;
          ctx.fillStyle = lit ? highlight : dot;
          const s = lit ? size * 1.5 : size;
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
        }
      }
    };

    const move = (e: PointerEvent) => { px = e.clientX; py = e.clientY; };
    const leave = () => { px = py = -9999; };

    colours();
    layout();
    frame = requestAnimationFrame(draw);

    const theme = new MutationObserver(colours);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", colours);
    window.addEventListener("resize", layout);
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);

    return () => {
      cancelAnimationFrame(frame);
      theme.disconnect();
      scheme.removeEventListener("change", colours);
      window.removeEventListener("resize", layout);
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, [gap, size, speed, reach, dotToken, highlightToken]);

  return (
    <div className="home-bg" aria-hidden="true">
      <canvas ref={ref} />
    </div>
  );
}
