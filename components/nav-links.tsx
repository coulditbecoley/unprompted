"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Knowing where you are is basic wayfinding, and a nav with no active state
 * makes every page feel like the same page.
 *
 * Five items is the ceiling: the header already wraps to two rows on a phone,
 * and the wordmark has to keep its own line. A sixth section would have to
 * replace one of these rather than join them.
 */
const LINKS = [
  { href: "/categories", label: "Categories" },
  { href: "/compare", label: "Compare" },
  { href: "/consensus", label: "Consensus" },
  { href: "/questions", label: "Questions" },
  { href: "/methodology", label: "Method" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="site-nav" aria-label="Sections">
      {LINKS.map((link) => {
        // A category board is "inside" Categories, so the section stays lit
        // while you are reading one.
        const active =
          pathname === link.href ||
          (link.href === "/categories" && pathname.startsWith("/chart"));
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
