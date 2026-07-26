// Custom auth storage adapter for Supabase.
// On native Capacitor apps, uses @capacitor/preferences (persists across app kills).
// On web, uses localStorage.
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

type SupabaseStorage = {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
  removeItem: (key: string) => Promise<void> | void;
};

const capacitorStorage: SupabaseStorage = {
  async getItem(key) {
    const { value } = await Preferences.get({ key });
    return value ?? null;
  },
  async setItem(key, value) {
    await Preferences.set({ key, value });
  },
  async removeItem(key) {
    await Preferences.remove({ key });
  },
};

export function getAuthStorage(): SupabaseStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    if (Capacitor.isNativePlatform()) return capacitorStorage;
  } catch {
    // Capacitor not available — fall through to localStorage
  }
  return window.localStorage as unknown as SupabaseStorage;
}
