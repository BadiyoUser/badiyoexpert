package com.badiyo.expert;

import android.os.Bundle;
import android.webkit.GeolocationPermissions;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * Custom MainActivity that overrides the WebView's WebChromeClient to auto-grant
 * HTML5 Geolocation permission for the app's own origin.
 *
 * Why this exists:
 *   Android's WebView does NOT automatically grant `navigator.geolocation` to
 *   page content, even when the host app already has ACCESS_FINE_LOCATION /
 *   ACCESS_COARSE_LOCATION granted at the OS level. Without an explicit
 *   onGeolocationPermissionsShowPrompt() override, the WebView silently drops
 *   the request — `getCurrentPosition()` never fires success OR error, and the
 *   Capacitor Geolocation plugin (which delegates through the WebView layer on
 *   some device/OEM configurations) hangs indefinitely.
 *
 * This override preserves all of Capacitor's default BridgeWebChromeClient
 * behavior (file chooser, permission bridging, etc.) and only adds the
 * geolocation auto-grant, since OS-level location permission is already
 * enforced via the AndroidManifest + runtime request in the JS layer.
 *
 * IMPORTANT: The Android project itself is NOT committed to the repo. It is
 * generated locally via `npx cap add android`. Capacitor CLI creates a default
 * MainActivity.java — after `cap add android`, replace the generated file with
 * this one (or keep this file and let it win in the copy). Then run
 * `npx cap sync android` and rebuild the APK.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        this.bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
            @Override
            public void onGeolocationPermissionsShowPrompt(
                String origin,
                GeolocationPermissions.Callback callback
            ) {
                // OS-level location permission is already handled by Capacitor's
                // Geolocation plugin (checkPermissions/requestPermissions). At the
                // WebView layer we unconditionally allow the page's own origin so
                // that navigator.geolocation calls don't hang waiting for a prompt
                // that the WebView never surfaces to the user.
                callback.invoke(origin, true, false);
            }
        });
    }
}
