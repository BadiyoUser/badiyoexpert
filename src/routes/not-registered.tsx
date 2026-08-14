import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Phone, MessageCircle, ShieldCheck } from "lucide-react";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/not-registered")({
  head: () => ({
    meta: [
      { title: "Not registered — badiyos Expert" },
      { name: "description", content: "This mobile number isn't registered with badiyos yet." },
    ],
  }),
  component: NotRegistered,
});

function NotRegistered() {
  const t = useT();
  const support = "+918007444464";
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background px-6 pb-[max(env(safe-area-inset-bottom),2rem)] pt-[max(env(safe-area-inset-top),1.5rem)]">
      <Link to="/login" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted" aria-label={t("common.back")}>
        <ChevronLeft className="h-6 w-6" />
      </Link>

      <div className="mt-8 flex flex-1 flex-col items-center justify-center text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[color:var(--color-accent)]">
          <ShieldCheck className="h-10 w-10 text-primary" strokeWidth={2} />
        </div>
        <h1 className="mt-6 text-[24px] font-bold leading-tight text-foreground">{t("nr.title")}</h1>
        <p className="mt-3 max-w-xs text-[15px] text-[color:var(--text-secondary)]">
          {t("nr.sub")}
        </p>

        <div className="mt-10 flex w-full flex-col gap-3">
          <a
            href={`tel:${support}`}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-primary text-[16px] font-bold text-primary-foreground shadow-[var(--shadow-brand-sm)]"
          >
            <Phone className="h-5 w-5" /> {t("nr.call")}
          </a>
          <a
            href={`https://wa.me/${support.replace(/[^\d]/g, "")}?text=Hi%20badiyos%2C%20I%20want%20to%20register%20as%20an%20Expert`}
            target="_blank" rel="noreferrer"
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] border border-border bg-card text-[16px] font-bold text-foreground"
          >
            <MessageCircle className="h-5 w-5" /> {t("nr.whatsapp")}
          </a>
        </div>
      </div>
    </div>
  );
}
