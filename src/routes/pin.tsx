import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Fingerprint } from "lucide-react";
import { z } from "zod";
import { expertApi } from "@/lib/expert-client";
import { supabase } from "@/integrations/supabase/client";
import {
  hasStoredPinForPhone,
  readPinForBiometric,
  clearStoredPin,
  savePinForBiometric,
} from "@/lib/secure-pin-storage";
import { isBiometricAvailable, promptBiometric } from "@/lib/biometric";
import badiyoGreen from "@/assets/badiyo-green.png.asset.json";
import { toast } from "sonner";

const searchSchema = z.object({ phone: z.string().optional() });

export const Route = createFileRoute("/pin")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Enter PIN — Badiyo Expert" },
      { name: "description", content: "Unlock with biometrics or your 4-digit PIN." },
    ],
  }),
  component: PinScreen,
});

function PinScreen() {
  const { phone } = Route.useSearch();
  const navigate = useNavigate();
  const [digits, setDigits] = useState<string[]>(["", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState<number>(0);
  const [biometricTried, setBiometricTried] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const autoTriedRef = useRef(false);

  useEffect(() => {
    if (!phone) navigate({ to: "/login" });
  }, [phone, navigate]);

  const submit = useCallback(
    async (code: string, opts: { silent?: boolean } = {}) => {
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
        try {
          await savePinForBiometric(phone, code);
        } catch {
          /* non-fatal */
        }
        navigate({ to: "/home" });
      } catch (err) {
        const msg = (err as Error).message ?? "Login failed";
        const match = msg.match(/(\d+)\s*seconds?/i);
        if (msg.toLowerCase().includes("too many") || msg.toLowerCase().includes("locked")) {
          setLocked(match ? Number(match[1]) : 15 * 60);
        }
        setDigits(["", "", "", ""]);
        setTimeout(() => inputs.current[0]?.focus(), 50);
        if (!opts.silent) {
          setError(msg);
          toast.error(msg);
        }
      } finally {
        setLoading(false);
      }
    },
    [phone, loading, navigate],
  );

  // Lockout countdown
  useEffect(() => {
    if (locked <= 0) return;
    const t = setTimeout(() => setLocked((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [locked]);

  // Biometric-first: auto-prompt on mount
  useEffect(() => {
    if (!phone || autoTriedRef.current) return;
    autoTriedRef.current = true;
    (async () => {
      const bio = await isBiometricAvailable();
      setBioAvailable(bio.available);
      const stored = await hasStoredPinForPhone(phone);
      if (!bio.available || !stored) {
        setBiometricTried(true);
        setShowManual(true);
        setTimeout(() => inputs.current[0]?.focus(), 50);
        return;
      }
      const res = await promptBiometric("Unlock Badiyo Expert");
      setBiometricTried(true);
      if (res.ok) {
        const storedPin = await readPinForBiometric(phone);
        if (storedPin) {
          await submit(storedPin, { silent: true });
          return;
        }
      }
      setShowManual(true);
      setTimeout(() => inputs.current[0]?.focus(), 50);
    })();
  }, [phone, submit]);

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

  const retryBiometric = async () => {
    if (!phone) return;
    const stored = await readPinForBiometric(phone);
    if (!stored) return;
    const res = await promptBiometric("Unlock Badiyo Expert");
    if (res.ok) void submit(stored, { silent: true });
  };

  async function fallbackToOtp() {
    if (!phone) return;
    setLoading(true);
    try {
      await expertApi.sendOtp(phone);
      await clearStoredPin();
      navigate({ to: "/otp", search: { phone } });
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-[100dvh] w-full bg-background">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-6 pb-[max(env(safe-area-inset-bottom),2.5rem)] pt-[max(env(safe-area-inset-top),4rem)]">
        <div className="flex justify-center">
          <img src={badiyoGreen.url} alt="Badiyo Expert" className="h-10 w-auto" />
        </div>

        <div className="mt-10 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Welcome back</h1>
          <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
            Sign in as{" "}
            <span className="font-semibold text-foreground">+91 {phone}</span>
          </p>
        </div>

        {!biometricTried && (
          <div className="mt-10 flex flex-col items-center gap-3 text-[color:var(--text-secondary)]">
            <Fingerprint className="h-14 w-14 text-primary" />
            <p className="text-sm">Waiting for biometric…</p>
          </div>
        )}

        {biometricTried && showManual && (
          <>
            <p className="mt-10 text-center text-sm font-semibold text-foreground">
              Enter your 4-digit PIN
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
            {bioAvailable && (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={retryBiometric}
                  className="flex items-center gap-2 text-sm font-semibold text-primary"
                >
                  <Fingerprint className="h-4 w-4" /> Use biometric
                </button>
              </div>
            )}
          </>
        )}

        {error && (
          <p className="mt-4 text-center text-sm font-medium text-[color:var(--color-destructive)]">
            {error}
          </p>
        )}
        {locked > 0 && (
          <p className="mt-2 text-center text-xs text-[color:var(--text-secondary)]">
            Try again in {Math.ceil(locked / 60)} min ({locked}s)
          </p>
        )}
        {loading && (
          <p className="mt-4 text-center text-sm text-[color:var(--text-secondary)]">Verifying…</p>
        )}

        <div className="mt-8 flex flex-col items-center gap-3 text-sm">
          <button
            type="button"
            onClick={fallbackToOtp}
            disabled={loading}
            className="font-semibold text-primary disabled:opacity-50"
          >
            Forgot PIN?
          </button>
          <button
            type="button"
            onClick={fallbackToOtp}
            disabled={loading}
            className="font-semibold text-[color:var(--text-secondary)] disabled:opacity-50"
          >
            Login with OTP instead
          </button>
          <button
            type="button"
            onClick={() => navigate({ to: "/login" })}
            className="text-[color:var(--text-secondary)]"
          >
            Change number
          </button>
        </div>

        <p className="mt-auto pt-10 text-center text-xs text-[color:var(--text-secondary)]">
          By continuing, you agree to Badiyo's Terms & Privacy Policy.
        </p>
      </div>
    </main>
  );
}
