import Link from "next/link";

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
    <section className="shell section">
      <p className="label">404</p>
      <h1 className="display" style={{ maxWidth: "18ch" }}>
        That page is not here.
      </h1>
      <p className="section-lead">
        Nothing has been deleted: run data is append-only and every week ever
        published is still where it was. This address just never named anything.
      </p>
      <p className="mono" style={{ fontSize: 12.5 }}>
        <Link href="/">The current board →</Link>
      </p>
      <p className="mono" style={{ fontSize: 12.5 }}>
        <Link href="/categories">Every category →</Link>
      </p>
    </section>
  );
}
