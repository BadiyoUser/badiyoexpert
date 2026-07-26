package com.badiyo.expert;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * Phase 2: Foreground service skeleton that keeps the expert "online" while the
 * app is backgrounded or swiped away.
 *
 * This phase only maintains the sticky foreground notification lifecycle —
 * Phase 3 will add the actual periodic location updates from inside this
 * service (fused location provider + POST to Supabase).
 *
 * Started/stopped from JS via BackgroundLocationPlugin.start/stopBackgroundService.
 * If background location permission is revoked at any point, the service
 * self-stops so we never claim to be "online" without eligibility.
 */
public class BackgroundAvailabilityService extends Service {

    /** Distinct low-importance channel — persistent status must be silent. */
    static final String STATUS_CHANNEL_ID = "expert_online_status";
    private static final int NOTIFICATION_ID = 4711;

    public static final String ACTION_START = "com.badiyo.expert.action.START_AVAILABILITY";
    public static final String ACTION_STOP = "com.badiyo.expert.action.STOP_AVAILABILITY";

    @Override
    public void onCreate() {
        super.onCreate();
        ensureStatusChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelfInternal();
            return START_NOT_STICKY;
        }

        // Guard: if background location permission was revoked between
        // start-request and service actually starting, bail out cleanly.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !hasBackgroundLocation()) {
            stopSelfInternal();
            return START_NOT_STICKY;
        }

        startForeground(NOTIFICATION_ID, buildStatusNotification());
        // START_STICKY so Android relaunches us if killed for memory pressure —
        // the expert opted in to background availability.
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void stopSelfInternal() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        stopSelf();
    }

    private Notification buildStatusNotification() {
        Intent openApp = new Intent(this, MainActivity.class);
        openApp.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT
            | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, openApp, piFlags);

        return new NotificationCompat.Builder(this, STATUS_CHANNEL_ID)
            .setContentTitle("Badiyo Expert — Online")
            .setContentText("You're receiving nearby job alerts")
            .setSmallIcon(android.R.drawable.presence_online)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(contentIntent)
            .build();
    }

    private void ensureStatusChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(STATUS_CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
            STATUS_CHANNEL_ID,
            "Online status",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Shown while you're online and available for jobs.");
        channel.setShowBadge(false);
        channel.enableVibration(false);
        channel.setSound(null, null);
        manager.createNotificationChannel(channel);
    }

    private boolean hasBackgroundLocation() {
        return ContextCompat.checkSelfPermission(
            this, Manifest.permission.ACCESS_BACKGROUND_LOCATION
        ) == PackageManager.PERMISSION_GRANTED;
    }
}
