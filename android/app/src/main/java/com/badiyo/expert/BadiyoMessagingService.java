package com.badiyo.expert;

import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Full-screen "ringing" alert for new booking pushes.
 *
 * Extends the Capacitor push plugin's MessagingService (instead of
 * FirebaseMessagingService directly) so token registration and the JS
 * pushNotificationReceived / pushNotificationActionPerformed events keep
 * working exactly as before for every other message type.
 *
 * Behaviour:
 *   - Data-only message with alert_type = "assigned" | "broadcast" AND the app
 *     NOT in the foreground  -> build a CATEGORY_CALL, ongoing, full-screen
 *     intent notification on the existing "new_booking_alerts" channel and
 *     launch {@link BookingRingActivity} (rings + wakes/unlocks the screen).
 *   - Anything else (app open, or any non-alert push) -> delegate to super,
 *     which forwards to the webview. The existing in-app looping alert on the
 *     Home screen is therefore untouched.
 */
public class BadiyoMessagingService extends MessagingService {

    private static final String TAG = "BadiyoFCM";

    static final String CHANNEL_ID = "new_booking_alerts";
    static final int RING_NOTIFICATION_ID = 5120;

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String alertType = data.get("alert_type");

        boolean isBookingAlert =
            "assigned".equals(alertType) || "broadcast".equals(alertType);

        if (!isBookingAlert) {
            super.onMessageReceived(remoteMessage);
            return;
        }

        if (MainActivity.isAppInForeground()) {
            // App is open: the web layer already plays its own looping alert
            // and renders the broadcast card. Do not ring twice.
            Log.d(TAG, "booking alert while foreground — delegating to webview");
            super.onMessageReceived(remoteMessage);
            return;
        }

        try {
            showRingingNotification(data);
        } catch (Throwable t) {
            Log.e(TAG, "showRingingNotification failed — falling back", t);
            super.onMessageReceived(remoteMessage);
        }
    }

    private void showRingingNotification(Map<String, String> data) {
        String bookingId = orEmpty(data.get("booking_id"));
        String alertType = orEmpty(data.get("alert_type"));
        String title = fallback(data.get("title"), "New booking nearby");
        String body = fallback(data.get("body"), "Tap to view details");
        String address = orEmpty(data.get("address"));
        String duration = orEmpty(data.get("duration"));
        int timeoutSeconds = parseInt(data.get("timeout_seconds"), 60);

        Log.d(TAG, "ring alert booking=" + bookingId + " type=" + alertType
            + " timeout=" + timeoutSeconds + "s");

        Intent ring = new Intent(this, BookingRingActivity.class);
        ring.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_NO_USER_ACTION
        );
        ring.putExtra(BookingRingActivity.EXTRA_BOOKING_ID, bookingId);
        ring.putExtra(BookingRingActivity.EXTRA_ALERT_TYPE, alertType);
        ring.putExtra(BookingRingActivity.EXTRA_TITLE, title);
        ring.putExtra(BookingRingActivity.EXTRA_BODY, body);
        ring.putExtra(BookingRingActivity.EXTRA_ADDRESS, address);
        ring.putExtra(BookingRingActivity.EXTRA_DURATION, duration);
        ring.putExtra(BookingRingActivity.EXTRA_TIMEOUT, timeoutSeconds);

        PendingIntent fullScreen = PendingIntent.getActivity(
            this, bookingId.hashCode(), ring, piFlags(PendingIntent.FLAG_UPDATE_CURRENT)
        );

        PendingIntent acceptPi = PendingIntent.getBroadcast(
            this,
            ("accept:" + bookingId).hashCode(),
            BookingAlertActions.acceptIntent(this, bookingId),
            piFlags(PendingIntent.FLAG_UPDATE_CURRENT)
        );
        PendingIntent rejectPi = PendingIntent.getBroadcast(
            this,
            ("reject:" + bookingId).hashCode(),
            BookingAlertActions.rejectIntent(this, bookingId),
            piFlags(PendingIntent.FLAG_UPDATE_CURRENT)
        );

        String text = address.isEmpty() ? body : (duration.isEmpty() ? address : duration + " · " + address);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setTimeoutAfter(timeoutSeconds * 1000L)
            .setFullScreenIntent(fullScreen, true)
            .setContentIntent(fullScreen)
            .addAction(0, "Accept", acceptPi)
            .addAction(0, "Reject", rejectPi);

        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;
        Notification n = builder.build();
        n.flags |= Notification.FLAG_INSISTENT; // keep ringing until acted on
        nm.notify(RING_NOTIFICATION_ID, n);

        // On locked / dozing devices the full-screen intent fires immediately.
        // When the device is merely idle-but-unlocked some OEMs only show the
        // heads-up, so start the activity ourselves too (safe: singleTask).
        KeyguardManager km = getSystemService(KeyguardManager.class);
        boolean locked = km != null && km.isKeyguardLocked();
        if (locked || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            try {
                startActivity(ring);
            } catch (Throwable t) {
                Log.w(TAG, "direct startActivity blocked; relying on full-screen intent", t);
            }
        }
    }

    static int piFlags(int base) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            ? base | PendingIntent.FLAG_IMMUTABLE
            : base;
    }

    static void cancelRingNotification(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(RING_NOTIFICATION_ID);
    }

    private static String orEmpty(String s) {
        return s == null ? "" : s;
    }

    private static String fallback(String s, String def) {
        return (s == null || s.isEmpty()) ? def : s;
    }

    private static int parseInt(String s, int def) {
        try {
            return s == null ? def : Integer.parseInt(s.trim());
        } catch (Throwable t) {
            return def;
        }
    }
}
