// Native (Capacitor) startup hooks. No-ops on the web build.
let initialized = false;

export async function initNativeShell(): Promise<void> {
  if (initialized) return;
  initialized = true;

  let Capacitor: typeof import("@capacitor/core").Capacitor | null = null;
  try {
    const mod = await import("@capacitor/core");
    Capacitor = mod.Capacitor;
  } catch {
    return;
  }
  if (!Capacitor?.isNativePlatform?.()) return;

  // Status bar: prevent the webview from rendering underneath the OS status
  // bar so the header/logo aren't clipped by the clock/wifi/battery row.
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: "#00B97A" });
  } catch (err) {
    console.warn("[native] StatusBar init failed", err);
  }
}
