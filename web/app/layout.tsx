import type { Metadata } from "next";
import "./globals.css";
import { SiteFooter, SiteHeader } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = {
  metadataBase: new URL("https://unprompted.report"),
  title: {
    default: "Unprompted — what AI recommends when nobody's paying",
    template: "%s · Unprompted",
  },
  description:
    "A free, public, weekly chart of which brands AI assistants actually name when people ask real buying questions. Every question asked five times. Method and raw data public.",
  openGraph: {
    type: "website",
    siteName: "Unprompted",
    title: "Unprompted — what AI recommends when nobody's paying",
    description:
      "Which brands do AI assistants actually name? Measured weekly, five runs per question, method and raw data public.",
  },
  robots: { index: true, follow: true },
};

/**
 * Applied before paint so a dark-mode visitor never sees a white flash.
 * Wrapped because storage access throws outright in some privacy modes.
 */
const NO_FLASH = `(function(){try{var t=localStorage.getItem('unprompted-theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Martian+Mono:wght@300;400;500;600&family=Mona+Sans:ital,wght@0,300..800;1,400&display=swap"
        />
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body>
        {/*
          THESIS: The query is visible and the output is live. Unprompted shows the
          exact code that produced the chart, and refuses the dashboard-of-cards
          arrangement every AI-visibility tool ships.
          OWN-WORLD: Flat matte graphite and Apple off-white carry every surface.
          Matte carbon-fibre twill is trim only — inlay rails, edge strips, chips.
          Monospace-dominant, grid-locked, hard 1px rules, zero rounded cards.
          STORY: A visitor understands in five seconds who the machines name,
          believes it because the method is running in front of them, and leaves
          with a screenshot.
          FIRST VIEWPORT: Left, the week's verdict at display scale. Right, the live
          question buffer typing itself. Below, the sequencer board, one cell per run.
          FORM: Algorave source floor. Seed 06ec8236. Palette overridden by brief.
          FINISH: unreviewed and undocumented is unfinished; this build ends with
          the finish review, the verdict, and DESIGN.md
        */}
        <ThemeToggle />
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
