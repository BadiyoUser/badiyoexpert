import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Loader2, Fingerprint } from "lucide-react";
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
import { Keypad } from "./set-pin";
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
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lockedFor, setLockedFor] = useState<number | null>(null);
  const [bioAvailable, setBioAvailable] = useState(false);
  const attemptedBioRef = useRef(false);

  useEffect(() => {
    if (!phone) navigate({ to: "/login" });
  }, [phone, navigate]);

  // Countdown for lockout.
  useEffect(() => {
    if (lockedFor === null || lockedFor <= 0) return;
    const t = setTimeout(() => setLockedFor((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
  }, [lockedFor]);

  // Biometric-first: auto-prompt on mount if hardware + stored pin exist.
  useEffect(() => {
    if (!phone || attemptedBioRef.current) return;
    attemptedBioRef.current = true;
    (async () => {
      const bio = await isBiometricAvailable();
      setBioAvailable(bio.available);
      if (!bio.available) return;
      const hasStored = await hasStoredPinForPhone(phone);
      if (!hasStored) return;
      await tryBiometric();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  async function tryBiometric() {
    if (!phone) return;
    const res = await promptBiometric("Unlock Badiyo Expert");
    if (!res.ok) return;
    const storedPin = await readPinForBiometric(phone);
    if (!storedPin) return;
    await submitPin(storedPin, { silent: true });
  }

  async function submitPin(candidate: string, opts: { silent?: boolean } = {}) {
    if (!phone || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await expertApi.verifyPin(phone, candidate);
      const { error: vErr } = await supabase.auth.verifyOtp({
        token_hash: res.token_hash,
        type: "magiclink",
      });
      if (vErr) throw vErr;
      // Refresh stored PIN so future biometric unlocks work.
      try {
        await savePinForBiometric(phone, candidate);
      } catch {
        /* non-fatal */
      }
      navigate({ to: "/home" });
    } catch (err) {
      const msg = (err as Error).message ?? "Login failed";
      if (!opts.silent) setError(msg);
      // Parse lockout: fetch the response detail via toast fallback.
      // The edge fn sets retry_after_seconds when locked (HTTP 429).
      const match = msg.match(/(\d+)\s*seconds?/i);
      if (msg.toLowerCase().includes("too many") || msg.toLowerCase().includes("locked")) {
        // Attempt to parse retry seconds from a re-thrown payload.
        // Without the raw payload, default to 15 min.
        setLockedFor(match ? Number(match[1]) : 15 * 60);
      }
      setPin("");
      if (!opts.silent) toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  function press(d: string) {
    if (loading || lockedFor) return;
    setError(null);
    setPin((prev) => {
      if (prev.length >= 4) return prev;
      const next = prev + d;
      if (next.length === 4) {
        // fire and forget
        setTimeout(() => submitPin(next), 50);
      }
      return next;
    });
  }
  function back() {
    if (loading) return;
    setError(null);
    setPin((p) => p.slice(0, -1));
  }

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
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background px-6 pb-[max(env(safe-area-inset-bottom),2rem)] pt-[max(env(safe-area-inset-top),1.5rem)]">
      <Link
        to="/login"
        className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted"
        aria-label="Back"
      >
        <ChevronLeft className="h-6 w-6" />
      </Link>

      <div className="mt-6">
        <h1 className="text-[28px] font-bold leading-tight text-foreground">Enter your PIN</h1>
        <p className="mt-2 text-[15px] text-[color:var(--text-secondary)]">
          Signing in as <span className="font-semibold text-foreground">+91 {phone}</span>
        </p>
      </div>

      <div className="mt-10 grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex h-16 items-center justify-center rounded-[14px] border border-border bg-card text-[26px] font-bold text-foreground"
          >
            {pin[i] ? "●" : ""}
          </div>
        ))}
      </div>

      {error && (
        <p className="mt-4 text-[13px] font-semibold text-[color:var(--color-destructive)]">{error}</p>
      )}

      {lockedFor !== null && lockedFor > 0 && (
        <p className="mt-2 text-[13px] font-semibold text-[color:var(--color-destructive)]">
          Locked. Try again in {Math.floor(lockedFor / 60)}:
          {String(lockedFor % 60).padStart(2, "0")}
        </p>
      )}

      <Keypad onPress={press} onBack={back} disabled={loading || !!lockedFor} />

      <div className="mt-6 flex flex-col gap-3">
        {bioAvailable && (
          <button
            type="button"
            onClick={tryBiometric}
            disabled={loading}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] border border-border bg-card text-[15px] font-bold text-foreground active:bg-muted"
          >
            <Fingerprint className="h-5 w-5" /> Use biometrics
          </button>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 text-[13px] text-[color:var(--text-secondary)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Verifying…
          </div>
        )}

        <button
          type="button"
          onClick={fallbackToOtp}
          className="text-[14px] font-semibold text-primary disabled:text-[color:var(--text-secondary)]"
          disabled={loading}
        >
          {lockedFor ? "Login with OTP instead" : "Forgot PIN? Login with OTP"}
        </button>
      </div>
    </div>
  );
}
