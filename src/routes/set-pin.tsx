import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, Delete } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { savePinForBiometric } from "@/lib/secure-pin-storage";
import { isBiometricAvailable } from "@/lib/biometric";
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
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const value = step === "enter" ? pin : confirm;
  const setValue = step === "enter" ? setPin : setConfirm;

  function press(d: string) {
    if (saving) return;
    setError(null);
    if (value.length >= 4) return;
    setValue(value + d);
  }
  function back() {
    setError(null);
    setValue(value.slice(0, -1));
  }

  async function next() {
    if (step === "enter") {
      if (pin.length !== 4) return;
      setStep("confirm");
      return;
    }
    if (confirm.length !== 4) return;
    if (pin !== confirm) {
      setError("PINs don't match. Try again.");
      setConfirm("");
      return;
    }
    setSaving(true);
    try {
      const { error: rpcErr } = await supabase.rpc("set_login_pin", { p_pin: pin });
      if (rpcErr) throw rpcErr;
      // Store PIN locally so biometrics can unlock it on this device.
      if (phone) {
        try {
          const bio = await isBiometricAvailable();
          if (bio.available) await savePinForBiometric(phone, pin);
        } catch {
          // non-fatal
        }
      }
      toast.success("PIN set. Use biometrics to sign in next time.");
      navigate({ to: "/home" });
    } catch (err) {
      setError((err as Error).message ?? "Could not save PIN");
      setSaving(false);
    }
  }

  const showConfirm = step === "confirm";

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background px-6 pb-[max(env(safe-area-inset-bottom),2rem)] pt-[max(env(safe-area-inset-top),1.5rem)]">
      <div className="mt-6">
        <h1 className="text-[28px] font-bold leading-tight text-foreground">
          {showConfirm ? "Confirm your PIN" : "Set your 4-digit PIN"}
        </h1>
        <p className="mt-2 text-[15px] text-[color:var(--text-secondary)]">
          {showConfirm
            ? "Re-enter the same PIN to confirm."
            : "You'll use this PIN (or biometrics) to sign in on this device."}
        </p>
      </div>

      <div className="mt-10 grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex h-16 items-center justify-center rounded-[14px] border border-border bg-card text-[26px] font-bold text-foreground"
          >
            {value[i] ? "●" : ""}
          </div>
        ))}
      </div>

      {error && (
        <p className="mt-4 text-[13px] font-semibold text-[color:var(--color-destructive)]">{error}</p>
      )}

      <Keypad onPress={press} onBack={back} disabled={saving} />

      <div className="mt-6">
        <button
          type="button"
          onClick={next}
          disabled={value.length !== 4 || saving}
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-primary text-[16px] font-bold text-primary-foreground shadow-[var(--shadow-brand-sm)] transition active:scale-[0.99] disabled:opacity-40 disabled:shadow-none"
        >
          {saving && <Loader2 className="h-5 w-5 animate-spin" />}
          {showConfirm ? (saving ? "Saving…" : "Save PIN") : "Continue"}
        </button>
      </div>
    </div>
  );
}

export function Keypad({
  onPress,
  onBack,
  disabled,
}: {
  onPress: (d: string) => void;
  onBack: () => void;
  disabled?: boolean;
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"] as const;
  return (
    <div className="mt-8 grid grid-cols-3 gap-3">
      {keys.map((k, i) => {
        if (k === "") return <div key={i} />;
        if (k === "back") {
          return (
            <button
              key={i}
              type="button"
              onClick={onBack}
              disabled={disabled}
              className="flex h-16 items-center justify-center rounded-[14px] text-foreground active:bg-muted"
              aria-label="Delete"
            >
              <Delete className="h-6 w-6" />
            </button>
          );
        }
        return (
          <button
            key={i}
            type="button"
            onClick={() => onPress(k)}
            disabled={disabled}
            className="flex h-16 items-center justify-center rounded-[14px] bg-card border border-border text-[24px] font-semibold text-foreground active:bg-muted"
          >
            {k}
          </button>
        );
      })}
    </div>
  );
}
