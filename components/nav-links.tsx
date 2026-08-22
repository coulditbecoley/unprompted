"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Knowing where you are is basic wayfinding, and a four-item nav with no active
 * state makes every page feel like the same page.
 */
const LINKS = [
  { href: "/chart", label: "Chart" },
  { href: "/compare", label: "Compare" },
  { href: "/questions", label: "Questions" },
  { href: "/methodology", label: "Method" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="site-nav" aria-label="Sections">
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            data-active={active}
            aria-current={active ? "page" : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
