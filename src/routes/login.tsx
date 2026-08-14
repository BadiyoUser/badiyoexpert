import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, Phone, Loader2 } from "lucide-react";
import badiyosGreen from "@/assets/badiyos-green.png.asset.json";
import { expertApi } from "@/lib/expert-client";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — badiyos Expert" },
      { name: "description", content: "Sign in to badiyos Expert with your registered mobile number." },
    ],
  }),
  component: LoginScreen,
});

function LoginScreen() {
  const t = useT();
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const digits = phone.replace(/\D/g, "").slice(-10);
  const valid = digits.length === 10;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || loading) return;
    setLoading(true);
    setError(null);
    try {
      // If this phone already has a PIN set, skip OTP and go straight to PIN entry.
      try {
        const { has_pin } = await expertApi.checkPin(digits);
        if (has_pin) {
          navigate({ to: "/pin", search: { phone: digits } });
          return;
        }
      } catch {
        // Fall back to OTP flow if the check fails.
      }
      await expertApi.sendOtp(digits);
      navigate({ to: "/otp", search: { phone: digits } });
    } catch (err) {
      const msg = (err as Error).message ?? t("login.failed");
      if (msg.includes("NOT_REGISTERED")) {
        navigate({ to: "/not-registered" });
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background px-6 pb-[max(env(safe-area-inset-bottom),2rem)] pt-[max(env(safe-area-inset-top),1.5rem)]">
      <div className="flex items-center justify-center py-8">
        <img src={badiyosGreen.url} alt="badiyos" className="h-10 w-auto" />
      </div>
      <div className="mt-4">
        <h1 className="text-[28px] font-bold leading-tight text-foreground">{t("login.title")}</h1>
        <p className="mt-2 text-[15px] text-[color:var(--text-secondary)]">
          {t("login.sub")}
        </p>
      </div>

      <form className="mt-8 flex flex-1 flex-col" onSubmit={submit}>
        <label className="text-[13px] font-semibold text-foreground">{t("login.label")}</label>
        <div className="mt-2 flex items-center gap-2 rounded-[14px] border border-border bg-card px-4 h-[52px] focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition">
          <Phone className="h-5 w-5 text-[color:var(--text-secondary)]" strokeWidth={2} />
          <span className="text-[15px] font-semibold text-foreground">+91</span>
          <div className="h-6 w-px bg-[color:var(--color-divider)]" />
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            placeholder={t("login.placeholder")}
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d\s]/g, ""))}
            className="flex-1 bg-transparent text-[16px] font-medium text-foreground outline-none placeholder:text-[color:var(--text-secondary)]/60"
          />
        </div>

        {error && <p className="mt-3 text-[13px] font-semibold text-[color:var(--color-destructive)]">{error}</p>}

        <p className="mt-4 text-[13px] text-[color:var(--text-secondary)]">
          {t("login.terms")}
        </p>

        <div className="mt-auto pt-8">
          <button
            type="submit"
            disabled={!valid || loading}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-primary text-[16px] font-bold text-primary-foreground shadow-[var(--shadow-brand-sm)] transition active:scale-[0.99] disabled:opacity-40 disabled:shadow-none"
          >
            {loading && <Loader2 className="h-5 w-5 animate-spin" />}
            {loading ? t("login.sending") : t("login.send")}
          </button>
          <Link to="/" className="mt-4 flex items-center justify-center gap-1 text-[14px] font-semibold text-[color:var(--text-secondary)]">
            <ChevronLeft className="h-4 w-4" /> {t("common.back")}
          </Link>
        </div>
      </form>
    </div>
  );
}
