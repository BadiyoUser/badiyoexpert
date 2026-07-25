import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useRef, useState, useEffect } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import { z } from "zod";
import { expertApi } from "@/lib/expert-client";
import { supabase } from "@/integrations/supabase/client";

const searchSchema = z.object({ phone: z.string().optional() });

export const Route = createFileRoute("/otp")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Verify code — Badiyo Expert" },
      { name: "description", content: "Enter the 4-digit code sent to your WhatsApp." },
    ],
  }),
  component: OtpScreen,
});

function OtpScreen() {
  const { phone } = Route.useSearch();
  const navigate = useNavigate();
  const [digits, setDigits] = useState<string[]>(["", "", "", ""]);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(30);
  const complete = digits.every((d) => d !== "");

  useEffect(() => {
    inputsRef.current[0]?.focus();
    if (!phone) navigate({ to: "/login" });
  }, [phone, navigate]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function verify(e?: React.FormEvent) {
    e?.preventDefault();
    if (!complete || loading || !phone) return;
    setLoading(true);
    setError(null);
    try {
      const { token_hash } = await expertApi.verifyOtp(phone, digits.join(""));
      const { error: vErr } = await supabase.auth.verifyOtp({ token_hash, type: "magiclink" });
      if (vErr) throw vErr;
      navigate({ to: "/home" });
    } catch (err) {
      setError((err as Error).message ?? "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    if (resendIn > 0 || !phone) return;
    try {
      await expertApi.sendOtp(phone);
      setResendIn(30);
      setError(null);
    } catch (err) {
      setError((err as Error).message ?? "Failed to resend");
    }
  }

  const setAt = (i: number, val: string) => {
    const v = val.replace(/\D/g, "").slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });
    if (v && i < 3) inputsRef.current[i + 1]?.focus();
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background px-6 pb-8 pt-6">
      <Link to="/login" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted" aria-label="Back">
        <ChevronLeft className="h-6 w-6" />
      </Link>

      <div className="mt-6">
        <h1 className="text-[28px] font-bold leading-tight text-foreground">Enter verification code</h1>
        <p className="mt-2 text-[15px] text-[color:var(--text-secondary)]">
          We sent a 4-digit code on WhatsApp to <span className="font-semibold text-foreground">+91 {phone}</span>.
        </p>
      </div>

      <form className="mt-10 flex flex-1 flex-col" onSubmit={verify}>
        <div className="flex items-center justify-between gap-3">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { inputsRef.current[i] = el; }}
              type="tel"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={(e) => setAt(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !digits[i] && i > 0) inputsRef.current[i - 1]?.focus();
              }}
              className="h-16 w-16 flex-1 rounded-[14px] border border-border bg-card text-center text-[26px] font-bold text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          ))}
        </div>

        {error && <p className="mt-4 text-[13px] font-semibold text-[color:var(--color-destructive)]">{error}</p>}

        <button
          type="button"
          onClick={resend}
          disabled={resendIn > 0}
          className="mt-6 self-start text-[14px] font-semibold text-primary disabled:text-[color:var(--text-secondary)]"
        >
          {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
        </button>

        <div className="mt-auto pt-8">
          <button
            type="submit"
            disabled={!complete || loading}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-primary text-[16px] font-bold text-primary-foreground shadow-[0_6px_20px_-6px_rgba(0,185,122,0.5)] transition active:scale-[0.99] disabled:opacity-40 disabled:shadow-none"
          >
            {loading && <Loader2 className="h-5 w-5 animate-spin" />}
            {loading ? "Verifying…" : "Verify"}
          </button>
        </div>
      </form>
    </div>
  );
}
