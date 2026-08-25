"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Reports a page view, and any click worth naming.
 *
 * Mounted once in the layout. Runs after render, so it never delays anything a
 * reader is waiting for, and uses `sendBeacon` where available so a view still
 * lands when the click that navigated away has already started.
 *
 * Clicks are captured by one listener on the document rather than a handler per
 * link. Every nav link, category tab and sort control on this site is already a
 * real anchor or button, so the DOM already knows what was clicked; adding
 * `data-track` to each of them would be the same information written twice, and
 * the second copy would be the one that goes stale.
 *
 * Nothing here identifies anybody. No cookie, no id, no fingerprint. The
 * referrer is sent whole and reduced to a hostname on the server before it is
 * stored, because it should not be the browser's job to be trusted with that.
 */

function send(body: Record<string, unknown>) {
  const payload = JSON.stringify(body);
  try {
    // sendBeacon returns false when it could not queue the request -- the queue
    // is full, or the browser refuses the blob type. Returning without checking
    // dropped the event silently and never reached the fallback below, which is
    // how this shipped counting agents and no humans at all.
    if (
      navigator.sendBeacon &&
      navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }))
    ) {
      return;
    }
  } catch {
    // sendBeacon can also throw on a blocked origin; fall through to fetch.
  }
  void fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => {});
}

/** The label a click is counted under, or null for one not worth counting. */
function labelFor(target: HTMLElement): string | null {
  const tab = target.closest<HTMLElement>(".cat-tab");
  if (tab) return `tab:${(tab.textContent ?? "").trim().slice(0, 40)}`;

  const sort = target.closest<HTMLElement>(".seq-sort");
  if (sort) return `sort:${(sort.textContent ?? "").trim().slice(0, 20)}`;

  const link = target.closest<HTMLAnchorElement>("a[href]");
  if (!link) return null;

  const href = link.getAttribute("href") ?? "";
  if (href.startsWith("http") || href.startsWith("mailto:")) {
    try {
      return `out:${new URL(href).hostname.replace(/^www\./, "")}`;
    } catch {
      return null;
    }
  }
  // Internal navigation already shows up as the next page view, so counting it
  // here as well would say the same thing twice. Only the routes that answer a
  // question about intent are named.
  if (/^\/(chart|brand|compare|consensus|questions|categories|methodology)/.test(href)) {
    return `nav:${href.split("/").slice(0, 3).join("/")}`;
  }
  if (href === "/feed.xml") return "nav:/feed.xml";
  return null;
}

export function Beacon() {
  const pathname = usePathname();

  useEffect(() => {
    send({ path: pathname, referrer: document.referrer || null });
  }, [pathname]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const label = labelFor(target);
      if (label) send({ path: window.location.pathname, event: label });
    }
    // Capture phase: a handler that stops propagation, or a link that navigates
    // before bubbling completes, must not be able to lose the count.
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);

  return null;
}
