import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { savePinForBiometric } from "@/lib/secure-pin-storage";
import { isBiometricAvailable } from "@/lib/biometric";
import badiyoGreen from "@/assets/badiyo-green.png.asset.json";
import { toast } from "sonner";

const searchSchema = z.object({ phone: z.string().optional() });

export const Route = createFileRoute("/set-pin")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Set your PIN — Badiyo Expert" },
      { name: "description", content: "Create a 4-digit PIN to sign in faster next time." },
    ],
  }),
  component: SetPinScreen,
});

function SetPinScreen() {
  const { phone } = Route.useSearch();
  const navigate = useNavigate();
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [pin1, setPin1] = useState<string[]>(["", "", "", ""]);
  const [pin2, setPin2] = useState<string[]>(["", "", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  const active = step === "enter" ? pin1 : pin2;
  const setActive = step === "enter" ? setPin1 : setPin2;

  useEffect(() => {
    if (!phone) navigate({ to: "/login" });
  }, [phone, navigate]);

  useEffect(() => {
    inputs.current[0]?.focus();
  }, [step]);

  const handleChange = (i: number, val: string) => {
    if (saving) return;
    const v = val.replace(/\D/g, "").slice(-1);
    const next = [...active];
    next[i] = v;
    setActive(next);
    setError(null);
    if (v && i < 3) inputs.current[i + 1]?.focus();
    if (next.every((d) => d)) {
      const code = next.join("");
      if (step === "enter") {
        setStep("confirm");
      } else {
        void submit(pin1.join(""), code);
      }
    }
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !active[i] && i > 0) inputs.current[i - 1]?.focus();
  };

  const submit = async (first: string, second: string) => {
    setError(null);
    if (first !== second) {
      setError("PINs don't match. Try again.");
      setPin1(["", "", "", ""]);
      setPin2(["", "", "", ""]);
      setStep("enter");
      return;
    }
    setSaving(true);
    try {
      const { error: rpcErr } = await supabase.rpc("set_login_pin", { p_pin: first });
      if (rpcErr) throw rpcErr;
      if (phone) {
        try {
          const bio = await isBiometricAvailable();
          if (bio.available) await savePinForBiometric(phone, first);
        } catch {
          /* non-fatal */
        }
      }
      toast.success("PIN set. Use biometrics to sign in next time.");
      navigate({ to: "/home" });
    } catch (err) {
      setError((err as Error).message ?? "Could not save PIN");
      setPin1(["", "", "", ""]);
      setPin2(["", "", "", ""]);
      setStep("enter");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-[100dvh] w-full bg-background">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-6 pb-[max(env(safe-area-inset-bottom),2.5rem)] pt-[max(env(safe-area-inset-top),4rem)]">
        <div className="flex justify-center">
          <img src={badiyoGreen.url} alt="Badiyo Expert" className="h-10 w-auto" />
        </div>

        <div className="mt-10 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {step === "enter" ? "Set your 4-digit PIN" : "Confirm your PIN"}
          </h1>
          <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
            {step === "enter"
              ? "You'll use this (or biometrics) to sign in next time."
              : "Re-enter the same 4 digits."}
          </p>
        </div>

        <div className="mt-10 flex justify-center gap-3">
          {active.map((d, i) => (
            <input
              key={`${step}-${i}`}
              ref={(el) => {
                inputs.current[i] = el;
              }}
              type="tel"
              inputMode="numeric"
              maxLength={1}
              value={d ? "•" : ""}
              disabled={saving}
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
        {saving && (
          <p className="mt-4 text-center text-sm text-[color:var(--text-secondary)]">Saving…</p>
        )}

        <p className="mt-auto pt-10 text-center text-xs text-[color:var(--text-secondary)]">
          Your PIN is stored securely on this device.
        </p>
      </div>
    </main>
  );
}
