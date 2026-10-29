import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
  description: "This address does not match a page. Browse Unprompted’s public AI brand charts to find the results you need.",
  openGraph: { title: "Page not found · Unprompted", description: "Find a public AI brand chart or browse the categories." },
};

/**
 * The page that did not exist.
 *
 * It records nothing, deliberately. Counting a miss from here was the obvious
 * place and the wrong one: Next renders the not-found boundary as part of the
 * tree for pages that resolve perfectly well, so a 200 on /consensus filed
 * itself as a 404 on /consensus. Rendering is not evidence of a status.
 *
 * The count lives in `proxy.ts` instead, which sees the path before anything
 * has decided what to do with it.
 */
export default function NotFound() {
  return (
    <section className="shell section" data-not-found>
      <p className="label">404</p>
      <h1 className="display page-title rise">
        That page is not here.
      </h1>
      <p className="section-lead">
        We could not find a page at this address. Check the link, or browse the
        categories to find a chart and its published history.
      </p>
      <div className="btn-row rise">
        <Link className="btn btn-go" href="/">See the latest published board <span className="arr" aria-hidden="true">→</span></Link>
        <Link className="btn" href="/categories">Browse categories</Link>
      </div>
    </section>
  );
}
