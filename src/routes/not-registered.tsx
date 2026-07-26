import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Phone, MessageCircle, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/not-registered")({
  head: () => ({
    meta: [
      { title: "Not registered — Badiyo Expert" },
      { name: "description", content: "This mobile number isn't registered with Badiyo yet." },
    ],
  }),
  component: NotRegistered,
});

function NotRegistered() {
  const support = "+918007444464";
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background px-6 pb-8 pt-6">
      <Link to="/login" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted" aria-label="Back">
        <ChevronLeft className="h-6 w-6" />
      </Link>

      <div className="mt-8 flex flex-1 flex-col items-center justify-center text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[color:var(--color-accent)]">
          <ShieldCheck className="h-10 w-10 text-primary" strokeWidth={2} />
        </div>
        <h1 className="mt-6 text-[24px] font-bold leading-tight text-foreground">Not a registered Expert yet</h1>
        <p className="mt-3 max-w-xs text-[15px] text-[color:var(--text-secondary)]">
          This number isn't onboarded with Badiyo. Contact our team to become a certified Expert.
        </p>

        <div className="mt-10 flex w-full flex-col gap-3">
          <a
            href={`tel:${support}`}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-primary text-[16px] font-bold text-primary-foreground shadow-[0_6px_20px_-6px_rgba(0,185,122,0.5)]"
          >
            <Phone className="h-5 w-5" /> Call Badiyo Team
          </a>
          <a
            href={`https://wa.me/${support.replace(/[^\d]/g, "")}?text=Hi%20Badiyo%2C%20I%20want%20to%20register%20as%20an%20Expert`}
            target="_blank" rel="noreferrer"
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] border border-border bg-card text-[16px] font-bold text-foreground"
          >
            <MessageCircle className="h-5 w-5" /> WhatsApp us
          </a>
        </div>
      </div>
    </div>
  );
}
