// Thin wrapper around @aparajita/capacitor-biometric-auth.
// Safe to import on web — it degrades to a no-op if the plugin isn't native.
import { Capacitor } from "@capacitor/core";

type BiometricAvailability = { available: boolean; reason?: string };

async function loadPlugin() {
  try {
    const mod = await import("@aparajita/capacitor-biometric-auth");
    return mod;
  } catch {
    return null;
  }
}

export async function isBiometricAvailable(): Promise<BiometricAvailability> {
  try {
    if (!Capacitor.isNativePlatform()) return { available: false, reason: "web" };
  } catch {
    return { available: false, reason: "web" };
  }
  const mod = await loadPlugin();
  if (!mod) return { available: false, reason: "plugin-missing" };
  try {
    const info = await mod.BiometricAuth.checkBiometry();
    return { available: !!info.isAvailable, reason: info.reason ?? undefined };
  } catch (err) {
    return { available: false, reason: (err as Error).message };
  }
}

export async function promptBiometric(reason = "Unlock badiyos Expert"): Promise<{ ok: boolean; error?: string }> {
  const mod = await loadPlugin();
  if (!mod) return { ok: false, error: "plugin-missing" };
  try {
    await mod.BiometricAuth.authenticate({
      reason,
      cancelTitle: "Use PIN",
      allowDeviceCredential: false,
      iosFallbackTitle: "Enter PIN",
      androidTitle: "badiyos Expert",
      androidSubtitle: "Unlock with biometrics",
      androidConfirmationRequired: false,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as { message?: string }).message ?? "cancelled" };
  }
}
