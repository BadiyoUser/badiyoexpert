import type { CapacitorConfig } from "@capacitor/cli";

// Capacitor config for the Badiyo Expert native shell.
// The Android/iOS projects are generated locally with `npx cap add` and are
// NOT committed to this repo — this file is the source of truth for their
// runtime configuration.
const config: CapacitorConfig = {
  appId: "com.badiyo.expert",
  appName: "Badiyo Expert",
  webDir: "dist",
  plugins: {
    StatusBar: {
      // Do not draw content underneath the OS status bar. The webview is
      // resized so the top of the app starts below the clock/wifi/battery row.
      overlaysWebView: false,
      style: "LIGHT",
      backgroundColor: "#0874FD",
    },
  },
};

export default config;
