import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, Phone, Loader2 } from "lucide-react";
import badiyoGreen from "@/assets/badiyo-green.png.asset.json";
import { expertApi } from "@/lib/expert-client";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Badiyo Expert" },
      { name: "description", content: "Sign in to Badiyo Expert with your registered mobile number." },
    ],
  }),
  component: LoginScreen,
});

function LoginScreen() {
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
      await expertApi.sendOtp(digits);
      navigate({ to: "/otp", search: { phone: digits } });
    } catch (err) {
      const msg = (err as Error).message ?? "Failed to send code";
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
        <img src={badiyoGreen.url} alt="Badiyo" className="h-10 w-auto" />
      </div>
      <div className="mt-4">
        <h1 className="text-[28px] font-bold leading-tight text-foreground">Welcome, Expert</h1>
        <p className="mt-2 text-[15px] text-[color:var(--text-secondary)]">
          Enter your registered mobile number. We'll send a 4-digit code on WhatsApp.
        </p>
      </div>

      <form className="mt-8 flex flex-1 flex-col" onSubmit={submit}>
        <label className="text-[13px] font-semibold text-foreground">Mobile number</label>
        <div className="mt-2 flex items-center gap-2 rounded-[14px] border border-border bg-card px-4 h-[52px] focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition">
          <Phone className="h-5 w-5 text-[color:var(--text-secondary)]" strokeWidth={2} />
          <span className="text-[15px] font-semibold text-foreground">+91</span>
          <div className="h-6 w-px bg-[color:var(--color-divider)]" />
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="98765 43210"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d\s]/g, ""))}
            className="flex-1 bg-transparent text-[16px] font-medium text-foreground outline-none placeholder:text-[color:var(--text-secondary)]/60"
          />
        </div>

        {error && <p className="mt-3 text-[13px] font-semibold text-[color:var(--color-destructive)]">{error}</p>}

        <p className="mt-4 text-[13px] text-[color:var(--text-secondary)]">
          Only registered Badiyo Experts can sign in. By continuing you agree to Badiyo's Terms and Privacy Policy.
        </p>

        <div className="mt-auto pt-8">
          <button
            type="submit"
            disabled={!valid || loading}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-primary text-[16px] font-bold text-primary-foreground shadow-[var(--shadow-brand-sm)] transition active:scale-[0.99] disabled:opacity-40 disabled:shadow-none"
          >
            {loading && <Loader2 className="h-5 w-5 animate-spin" />}
            {loading ? "Sending…" : "Send code"}
          </button>
          <Link to="/" className="mt-4 flex items-center justify-center gap-1 text-[14px] font-semibold text-[color:var(--text-secondary)]">
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
        </div>
      </form>
    </div>
  );
}
