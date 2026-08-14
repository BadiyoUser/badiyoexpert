import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { ChevronLeft, AlertTriangle, Loader2, Phone, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { expertApi, useExpertSession } from "@/lib/expert-client";
import { useT } from "@/lib/i18n";

const searchSchema = z.object({ booking_id: z.string().optional() });

export const Route = createFileRoute("/sos")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "SOS — Badiyo Expert" },
      { name: "description", content: "Emergency alert to the Badiyo Support team." },
    ],
  }),
  component: SosScreen,
});

function SosScreen() {
  const t = useT();
  const { booking_id } = Route.useSearch();
  const { loading, userId } = useExpertSession();
  const navigate = useNavigate();
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [err, setErr] = useState<string | null>(null);
  const support = "+918007444464";

  async function sendAlert() {
    if (state !== "idle") return;
    setState("sending"); setErr(null);
    let coords: { latitude: number; longitude: number } | null = null;
    try {
      coords = await new Promise((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        const t = setTimeout(() => resolve(null), 7000);
        navigator.geolocation.getCurrentPosition(
          (pos) => { clearTimeout(t); resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }); },
          () => { clearTimeout(t); resolve(null); },
          { timeout: 7000, maximumAge: 60000, enableHighAccuracy: false },
        );
      });
    } catch { /* ignore */ }
    try {
      await expertApi.sosAlert({
        booking_id: booking_id ?? null,
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
        notes: "Expert triggered SOS from mobile app",
      });
      setState("sent");
    } catch (e) {
      setState("idle"); setErr((e as Error).message);
    }
  }

  if (loading || !userId) return <div className="flex min-h-[100dvh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  if (state === "sent") {
    return (
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background px-6 pb-[max(env(safe-area-inset-bottom),2rem)] pt-[max(env(safe-area-inset-top),1.5rem)]">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[color:var(--color-accent)]">
            <CheckCircle2 className="h-12 w-12 text-primary" />
          </div>
          <h1 className="mt-5 text-[24px] font-bold text-foreground">{t("sos.sent.title")}</h1>
          <p className="mt-2 max-w-xs text-[14px] text-[color:var(--text-secondary)]">
            {t("sos.sent.sub")}
          </p>
          <a href={`tel:${support}`} className="mt-8 flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-primary text-[16px] font-bold text-primary-foreground shadow-[var(--shadow-brand-sm)]">
            <Phone className="h-5 w-5" /> {t("sos.callSupport")}
          </a>
          <button onClick={() => navigate({ to: "/home" })} className="mt-4 text-[14px] font-semibold text-[color:var(--text-secondary)]">{t("sos.back")}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background px-6 pb-[max(env(safe-area-inset-bottom),2rem)] pt-[max(env(safe-area-inset-top),1.5rem)]">
      <Link to="/home" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted">
        <ChevronLeft className="h-6 w-6" />
      </Link>

      <div className="mt-8">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[color:var(--color-destructive)]/10">
          <AlertTriangle className="h-8 w-8 text-[color:var(--color-destructive)]" strokeWidth={2.2} />
        </div>
        <h1 className="mt-5 text-[26px] font-bold text-foreground">{t("sos.title")}</h1>
        <p className="mt-2 text-[15px] text-[color:var(--text-secondary)]">
          {t("sos.desc")}
        </p>
      </div>

      {err && <p className="mt-6 text-[13px] font-semibold text-[color:var(--color-destructive)]">{err}</p>}

      <div className="mt-auto pt-8">
        <button
          onClick={sendAlert}
          disabled={state === "sending"}
          className="flex h-[64px] w-full items-center justify-center gap-2 rounded-[14px] bg-[color:var(--color-destructive)] text-[17px] font-bold text-white shadow-[0_10px_28px_-10px_rgba(239,68,68,0.6)] transition active:scale-[0.99] disabled:opacity-60"
        >
          {state === "sending" ? <Loader2 className="h-5 w-5 animate-spin" /> : <AlertTriangle className="h-5 w-5" />}
          {state === "sending" ? t("sos.sending") : t("sos.send")}
        </button>
        <a href={`tel:${support}`} className="mt-3 flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] border border-border bg-card text-[16px] font-bold text-foreground">
          <Phone className="h-4 w-4" /> {t("sos.callDirect")}
        </a>
      </div>
    </div>
  );
}
