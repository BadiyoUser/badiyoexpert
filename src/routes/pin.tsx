import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { expertApi } from "@/lib/expert-client";
import { supabase } from "@/integrations/supabase/client";
import { clearStoredPin } from "@/lib/secure-pin-storage";
import { registerThisDevice } from "@/lib/devices";
import badiyosGreen from "@/assets/badiyos-green.png.asset.json";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";

const searchSchema = z.object({ phone: z.string().optional() });

export const Route = createFileRoute("/pin")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Enter PIN — badiyos Expert" },
      { name: "description", content: "Unlock with your 4-digit PIN." },
    ],
  }),
  component: PinScreen,
});

function PinScreen() {
  const t = useT();
  const { phone } = Route.useSearch();
  const navigate = useNavigate();
  const [digits, setDigits] = useState<string[]>(["", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState<number>(0);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (!phone) navigate({ to: "/login" });
  }, [phone, navigate]);

  useEffect(() => {
    setTimeout(() => inputs.current[0]?.focus(), 50);
  }, []);

  const submit = useCallback(
    async (code: string) => {
      if (!phone || loading) return;
      setLoading(true);
      setError(null);
      try {
        const res = await expertApi.verifyPin(phone, code);
        const { error: vErr } = await supabase.auth.verifyOtp({
          token_hash: res.token_hash,
          type: "magiclink",
        });
        if (vErr) throw vErr;
        const reg = await registerThisDevice().catch(() => ({ status: "registered" as const }));
        if (reg.status === "limit_reached") {
          navigate({ to: "/devices", search: { limit: "1" } });
          return;
        }
        navigate({ to: "/home" });
      } catch (err) {
        const msg = (err as Error).message ?? t("pin.loginFailed");
        const match = msg.match(/(\d+)\s*seconds?/i);
        if (msg.toLowerCase().includes("too many") || msg.toLowerCase().includes("locked")) {
          setLocked(match ? Number(match[1]) : 15 * 60);
        }
        setDigits(["", "", "", ""]);
        setTimeout(() => inputs.current[0]?.focus(), 50);
        setError(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    },
    [phone, loading, navigate, t],
  );

  // Lockout countdown
  useEffect(() => {
    if (locked <= 0) return;
    const t = setTimeout(() => setLocked((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [locked]);

  const handleChange = (i: number, val: string) => {
    if (locked > 0 || loading) return;
    const v = val.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[i] = v;
    setDigits(next);
    setError(null);
    if (v && i < 3) inputs.current[i + 1]?.focus();
    if (next.every((d) => d)) void submit(next.join(""));
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
  };

  async function fallbackToOtp() {
    if (!phone) return;
    setLoading(true);
    try {
      await expertApi.sendOtp(phone);
      await clearStoredPin();
      navigate({ to: "/otp", search: { phone } });
    } catch (err) {
      toast.error((err as Error).message ?? t("pin.otpFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-[100dvh] w-full bg-background">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-6 pb-[max(env(safe-area-inset-bottom),2.5rem)] pt-[max(env(safe-area-inset-top),4rem)]">
        <div className="flex justify-center">
          <img src={badiyosGreen.url} alt="badiyos Expert" className="h-10 w-auto" />
        </div>

        <div className="mt-10 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("pin.welcome")}</h1>
          <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
            {t("pin.signInAs")}{" "}
            <span className="font-semibold text-foreground">+91 {phone}</span>
          </p>
        </div>

        <p className="mt-10 text-center text-sm font-semibold text-foreground">
          {t("pin.enter")}
        </p>
        <div className="mt-4 flex justify-center gap-3">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                inputs.current[i] = el;
              }}
              type="tel"
              inputMode="numeric"
              maxLength={1}
              value={d ? "•" : ""}
              disabled={locked > 0 || loading}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              className="h-16 w-14 rounded-[14px] border-2 border-border bg-card text-center text-3xl font-bold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-[color:var(--primary)]/20 disabled:opacity-50"
            />
          ))}
        </div>

        {error && (
          <p className="mt-4 text-center text-sm font-medium text-[color:var(--color-destructive)]">
            {error}
          </p>
        )}
        {locked > 0 && (
          <p className="mt-2 text-center text-xs text-[color:var(--text-secondary)]">
            {t("pin.lockedIn", { min: Math.ceil(locked / 60), sec: locked })}
          </p>
        )}
        {loading && (
          <p className="mt-4 text-center text-sm text-[color:var(--text-secondary)]">{t("pin.verifying")}</p>
        )}

        <div className="mt-8 flex flex-col items-center gap-3 text-sm">
          <button
            type="button"
            onClick={fallbackToOtp}
            disabled={loading}
            className="font-semibold text-primary disabled:opacity-50"
          >
            {t("pin.forgot")}
          </button>
          <button
            type="button"
            onClick={() => navigate({ to: "/login" })}
            className="text-[color:var(--text-secondary)]"
          >
            {t("pin.changeNumber")}
          </button>
        </div>

        <p className="mt-auto pt-10 text-center text-xs text-[color:var(--text-secondary)]">
          {t("pin.terms")}
        </p>
      </div>
    </main>
  );
}
