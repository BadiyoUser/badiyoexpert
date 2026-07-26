// Local secure storage for the login PIN, unlocked by device biometrics.
//
// Uses @capacitor/preferences (Android SharedPreferences / iOS Keychain-backed
// UserDefaults via the plugin) with a dedicated namespace. The PIN is only
// ever released after a successful biometric prompt, so at rest it's protected
// by the same OS sandbox that guards the Supabase session.
//
// If stronger at-rest protection is later required, swap the implementation
// for a native EncryptedSharedPreferences / Keychain plugin — the public
// interface (savePin/readPin/clearPin) stays the same.
import { Preferences } from "@capacitor/preferences";

const KEY = "badiyo-expert.login-pin.v1";

export async function savePinForBiometric(phone: string, pin: string) {
  await Preferences.set({ key: KEY, value: JSON.stringify({ phone, pin }) });
}

export async function readPinForBiometric(phone: string): Promise<string | null> {
  const { value } = await Preferences.get({ key: KEY });
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { phone: string; pin: string };
    if (parsed.phone !== phone) return null;
    return parsed.pin;
  } catch {
    return null;
  }
}

export async function clearStoredPin() {
  await Preferences.remove({ key: KEY });
}

export async function hasStoredPinForPhone(phone: string): Promise<boolean> {
  const { value } = await Preferences.get({ key: KEY });
  if (!value) return false;
  try {
    return (JSON.parse(value) as { phone: string }).phone === phone;
  } catch {
    return false;
  }
}
