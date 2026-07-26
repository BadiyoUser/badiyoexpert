// JS bridge to the native BackgroundLocationPlugin (Android only).
// No-op on web / iOS — returns a "not available" state so the UI can hide itself.
import { registerPlugin, Capacitor } from "@capacitor/core";

export type BgLocationStatus = {
  foreground: boolean;
  background: boolean;
  sdkInt: number;
  /** True on Android 11+ where request() cannot open a dialog — must openSettings(). */
  mustUseSettings: boolean;
  /** True if the native plugin isn't available (web/iOS or plugin not installed). */
  unavailable?: boolean;
};

export type BgLocationRequestResult = {
  granted: boolean;
  reason?: "foreground_not_granted" | "must_open_settings" | "denied";
};

interface BackgroundLocationPlugin {
  check(): Promise<Omit<BgLocationStatus, "unavailable">>;
  request(): Promise<BgLocationRequestResult>;
  openSettings(): Promise<void>;
}

const Plugin = registerPlugin<BackgroundLocationPlugin>("BackgroundLocation");

function isAndroid(): boolean {
  try {
    return Capacitor.isNativePlatform?.() && Capacitor.getPlatform?.() === "android";
  } catch {
    return false;
  }
}

export async function checkBackgroundLocation(): Promise<BgLocationStatus> {
  if (!isAndroid()) {
    return { foreground: false, background: false, sdkInt: 0, mustUseSettings: false, unavailable: true };
  }
  try {
    return await Plugin.check();
  } catch (err) {
    console.warn("[bg-location] check failed", err);
    return { foreground: false, background: false, sdkInt: 0, mustUseSettings: false, unavailable: true };
  }
}

export async function requestBackgroundLocation(): Promise<BgLocationRequestResult> {
  if (!isAndroid()) return { granted: false, reason: "must_open_settings" };
  return Plugin.request();
}

export async function openAppLocationSettings(): Promise<void> {
  if (!isAndroid()) return;
  await Plugin.openSettings();
}
