// Stable per-install device identifier.
// Generated once on first launch and persisted in @capacitor/preferences
// (Android SharedPreferences / iOS keychain-backed storage, localStorage on web).
import { Preferences } from "@capacitor/preferences";
import { Capacitor } from "@capacitor/core";

const KEY = "badiyo-expert.device-id.v1";

function uuid(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const { value } = await Preferences.get({ key: KEY });
  if (value) {
    cached = value;
    return value;
  }
  const id = uuid();
  await Preferences.set({ key: KEY, value: id });
  cached = id;
  return id;
}

export function getDeviceLabel(): string {
  let platform = "Web";
  try {
    platform = Capacitor.getPlatform();
  } catch {
    /* ignore */
  }
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const model =
    /Android\s[\d.]+;\s([^)]+?)(?:\sBuild|\))/.exec(ua)?.[1] ??
    (/iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : null);
  const nice = platform === "android" ? "Android" : platform === "ios" ? "iOS" : "Web";
  return model ? `${nice} · ${model}`.slice(0, 60) : nice;
}
