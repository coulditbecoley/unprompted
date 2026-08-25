"use client";

import { useState } from "react";

/**
 * Write to the operator.
 *
 * Sits under the weekly signup because they are the same question asked two
 * ways: the signup is "send me this", this is "tell me something about it".
 * A publication whose whole pitch is that its method is public and auditable
 * needs somewhere for a person to say the method is wrong.
 *
 * Posted through fetch rather than a native form POST. The CSP allows
 * api.web3forms.com in connect-src, and a native submit would navigate the
 * reader away to the provider's own response page, losing the board and the
 * scroll position for a two-line acknowledgement.
 *
 * The access key is public by design -- Web3Forms puts it in client HTML, so
 * every visitor can read it. It still comes from the environment rather than
 * being committed, because this repository is public and a key in git history
 * cannot be rotated by editing a file. `.gitignore` already keeps `.env*.local`
 * out, and the audit checked that nothing tracked carries a credential.
 */

// Exported so the weekly signup can reuse them for its own inbox fallback
// rather than carrying a second copy of the endpoint that would drift.
export const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";
export const WEB3FORMS_KEY = process.env.NEXT_PUBLIC_WEB3FORMS_KEY;
const MAX_MESSAGE = 4000;

type State = "idle" | "sending" | "done" | "error";

export function Contact() {
  const [state, setState] = useState<State>("idle");
  const [note, setNote] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    // Honeypot. A real person never sees this field, so anything in it came
    // from something filling every input on the page. The audit noted this
    // form's sibling has no abuse controls at all; this is the cheap half.
    if (data.get("botcheck")) {
      setState("done");
      setNote("Thanks. I read everything that comes through here.");
      form.reset();
      return;
    }

    if (!WEB3FORMS_KEY) {
      setState("error");
      setNote(
        "This form is not configured: NEXT_PUBLIC_WEB3FORMS_KEY is unset. Email works in the meantime.",
      );
      return;
    }

    setState("sending");
    setNote("");
    data.set("access_key", WEB3FORMS_KEY);
    data.set("subject", `Unprompted: message from ${data.get("name") || "a reader"}`);

    try {
      const res = await fetch(WEB3FORMS_ENDPOINT, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: data,
      });
      const body = (await res.json()) as { success?: boolean; message?: string };

      if (res.ok && body.success) {
        setState("done");
        setNote("Thanks. I read everything that comes through here.");
        form.reset();
        return;
      }
      setState("error");
      setNote(body.message ?? "That did not send.");
    } catch {
      setState("error");
      setNote("Could not reach the form service.");
    }
  }

  return (
    <div className="contact">
      <p className="label">Say something</p>
      <h3 className="contact-head">
        Found a brand we are missing, or a number that looks wrong?
      </h3>
      <p className="subscribe-lead">
        Corrections are the most useful thing anyone sends. Every alias decision
        and every held week is in the public repository, so a specific complaint
        can be checked against the data.
      </p>

      <form onSubmit={submit} className="contact-form">
        {/* The provided markup had no labels at all. Placeholders are not
            labels: they vanish on focus and screen readers do not announce
            them as names for the field. */}
        <div className="contact-pair">
          <label htmlFor="contact-name" className="contact-label">
            Name
          </label>
          <input
            id="contact-name"
            name="name"
            type="text"
            required
            autoComplete="name"
            maxLength={120}
            className="subscribe-input"
            disabled={state === "sending"}
          />
        </div>

        <div className="contact-pair">
          <label htmlFor="contact-email" className="contact-label">
            Email
          </label>
          <input
            id="contact-email"
            name="email"
            type="email"
            required
            inputMode="email"
            autoComplete="email"
            maxLength={254}
            className="subscribe-input mono"
            disabled={state === "sending"}
          />
        </div>

        <div className="contact-pair contact-pair-wide">
          <label htmlFor="contact-message" className="contact-label">
            Message
          </label>
          <textarea
            id="contact-message"
            name="message"
            required
            rows={4}
            maxLength={MAX_MESSAGE}
            className="subscribe-input contact-textarea"
            disabled={state === "sending"}
          />
        </div>

        {/* Off-screen rather than display:none: some bots skip hidden inputs. */}
        <input
          type="checkbox"
          name="botcheck"
          className="sr-only"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
        />

        <button
          type="submit"
          className="share-btn subscribe-submit contact-submit"
          disabled={state === "sending"}
        >
          {state === "sending" ? "SENDING…" : "SEND"}
        </button>
      </form>

      {note && (
        <p
          className="mono subscribe-msg"
          data-state={state}
          role={state === "error" ? "alert" : "status"}
        >
          {note}
        </p>
      )}
    </div>
  );
}
