package com.badiyo.expert;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * Custom MainActivity:
 *   1. Overrides WebChromeClient to auto-grant HTML5 Geolocation for the app's
 *      own origin (Capacitor still enforces OS-level permission via JS layer).
 *   2. Registers the "new_booking_alerts" NotificationChannel on Android O+
 *      so FCM pushes for new bookings ring loudly with heads-up + vibration.
 *
 * The Android project is NOT committed to the repo — it's generated locally via
 * `npx cap add android`. After generation, keep this MainActivity.java and run
 * `npx cap sync android` before rebuilding the APK.
 */
public class MainActivity extends BridgeActivity {

    private static final String NEW_BOOKING_CHANNEL_ID = "new_booking_alerts";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register custom plugins BEFORE super.onCreate so Capacitor picks them up.
        registerPlugin(BackgroundLocationPlugin.class);
        super.onCreate(savedInstanceState);



        this.bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
            @Override
            public void onGeolocationPermissionsShowPrompt(
                String origin,
                GeolocationPermissions.Callback callback
            ) {
                callback.invoke(origin, true, false);
            }
        });

        createNewBookingNotificationChannel();
    }

    private void createNewBookingNotificationChannel() {
        // NotificationChannel API is only available on Android O (API 26) and above.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        // Idempotent — calling createNotificationChannel with an existing ID is a no-op
        // for the user-modifiable settings (importance, sound), but we still guard to
        // avoid unnecessary work on every launch.
        if (manager.getNotificationChannel(NEW_BOOKING_CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
            NEW_BOOKING_CHANNEL_ID,
            "New Booking Alerts",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Loud alerts when a new booking is available nearby.");

        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 0, 400, 200, 400 });

        Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        channel.setSound(soundUri, audioAttributes);

        // Leave setBypassDnd off — requires user-granted DND access policy.
        channel.enableLights(true);

        manager.createNotificationChannel(channel);
    }
}
