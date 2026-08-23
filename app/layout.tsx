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
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"
        />
        <link
          rel="alternate"
          type="application/atom+xml"
          title="Unprompted — weekly chart"
          href="/feed.xml"
        />
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body>
        {/*
          The direction contract, emitted as a real HTML comment so it survives
          the production build. A JSX comment is compiler syntax and reaches no
          output, which makes it a contract nobody can audit.
        */}
        <div
          style={{ display: "none" }}
          dangerouslySetInnerHTML={{
            __html: `<!--
THESIS: A market-data board for machine recommendations. The numbers
are the design; it refuses the expressive, ornamented arrangement an
AI-visibility tool reaches for, and the decorated-hero landing page.
OWN-WORLD: Near-black with a cool bias, one elevated surface, hairline
rules, a single 6px radius. Geist and Geist Mono, tabular numerals
everywhere. Colour is reserved: green and red mean movement and
nothing else, blue means interactive. No accent competes with them.
STORY: A visitor sees who the machines name in five seconds, believes
it because the method is one click away, and leaves with a screenshot.
FIRST VIEWPORT: The week's verdict at display scale on the left, the
live question buffer typing itself on the right, the ranked board
directly beneath with rotation bars, per-question steps and movement.
FORM: The category standard, taken as the standing exit by the user.
Seed 5e1f2e83. Craft bar set by the user: Linear, Vercel.
FINISH: unreviewed and undocumented is unfinished; this build ends with
the finish review, the verdict, and DESIGN.md
-->`,
          }}
        />
        <ThemeToggle />
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
