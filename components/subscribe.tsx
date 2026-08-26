"use client";

import { useState } from "react";

import { Contact, WEB3FORMS_ENDPOINT, WEB3FORMS_KEY } from "@/components/contact";
import { send } from "@/components/beacon";

/**
 * The return mechanism.
 *
 * Both options are offered plainly and the feed is not treated as the lesser
 * one: for this audience it is often the better answer, and it is the option
 * that works without handing anybody an address.
 *
 * Nothing here gates anything. The chart is fully readable without it, which is
 * the whole strategy.
 */
/**
 * Deliver one address to the operator's inbox while there is no mailing list.
 *
 * Named so a mailbox rule can file signups apart from contact messages, and so
 * exporting the list into a real provider later is a search rather than a
 * trawl through everything the site has ever sent.
 */
async function sendToInbox(email: string): Promise<boolean> {
  if (!WEB3FORMS_KEY) return false;
  try {
    const res = await fetch(WEB3FORMS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        access_key: WEB3FORMS_KEY,
        subject: "Unprompted: new subscriber",
        from_name: "Unprompted signup",
        email,
        message: `New weekly-chart subscriber: ${email}`,
      }),
    });
    const body = (await res.json()) as { success?: boolean };
    return Boolean(res.ok && body.success);
  } catch {
    return false;
  }
}

export function Subscribe() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  /**
   * One place for "it worked", because there are two ways for it to work and
   * they must be indistinguishable to the visitor and countable to the
   * operator. Counted here rather than in the route: the fallback path never
   * reaches the server, so a server-side count would have reported zero
   * signups for exactly as long as there is no mailing provider -- which is
   * the entire period the number is being watched.
   *
   * The label says which path delivered it and nothing else. No address is
   * sent, and the click that started this is counted separately, so an attempt
   * that failed stays visible rather than being quietly rounded up into a
   * success.
   */
  function succeed(via: "provider" | "inbox") {
    setState("done");
    setMessage("Done. You will get the chart every Monday.");
    setEmail("");
    send({ path: window.location.pathname, event: `signup:${via}` });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;

    setState("sending");
    setMessage("");

    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        inbox?: boolean;
      };

      if (res.ok && data.ok) {
        succeed("provider");
        return;
      }

      // 503 with `inbox` means there is no mailing provider yet, so the address
      // goes to the operator instead. Sent from here rather than from the route
      // because Web3Forms refuses server-side calls on the free plan; a server
      // forward failed every time while looking entirely reasonable.
      if (res.status === 503 && data.inbox && (await sendToInbox(email))) {
        succeed("inbox");
        return;
      }

      setState("error");
      setMessage(
        data.error === "not_configured"
          ? "The email digest is not set up yet. The RSS feed works today."
          : (data.error ?? "That did not work."),
      );
    } catch {
      setState("error");
      setMessage("Could not reach the server.");
    }
  }

  return (
    <section className="subscribe">
      <span className="trim-top" aria-hidden="true" />
      <div className="subscribe-body">
        <p className="label">Get it every week</p>
        <h2 className="subscribe-head">
          The chart updates every Monday. Have it come to you.
        </h2>
        <p className="subscribe-lead">
          No account, no paywall, and nothing here is gated. Everything on this
          site stays free to read whether you subscribe or not. There is no
          mailing provider behind this yet, so for now your address reaches a
          person rather than a list, and a reply saying stop is all it takes.
        </p>

        <form onSubmit={submit} className="subscribe-form">
          <label htmlFor="subscribe-email" className="sr-only">
            Email address
          </label>
          <input
            id="subscribe-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="subscribe-input mono"
            disabled={state === "sending"}
          />
          <button
            type="submit"
            className="share-btn subscribe-submit"
            disabled={state === "sending" || !email.trim()}
          >
            {state === "sending" ? "SENDING…" : "EMAIL ME THE CHART"}
          </button>
        </form>

        {message && (
          <p
            className="mono subscribe-msg"
            data-state={state}
            role={state === "error" ? "alert" : "status"}
          >
            {message}
          </p>
        )}

        <p className="subscribe-alt mono">
          Prefer a feed?{" "}
          <a href="/feed.xml">Subscribe by RSS →</a> Same chart, no address
          needed.
        </p>

        <Contact />
      </div>
    </section>
  );
}
