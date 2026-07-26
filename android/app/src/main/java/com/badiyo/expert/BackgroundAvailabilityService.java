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
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * Phase 2: Foreground service skeleton that keeps the expert "online" while the
 * app is backgrounded or swiped away.
 *
 * IMPORTANT — Android 8+ contract: when started via
 * Context.startForegroundService(), the service MUST call startForeground()
 * within ~5s or the OS crashes the app with
 * ForegroundServiceDidNotStartInTimeException. Every code path in
 * onStartCommand() therefore calls startForeground() first, THEN decides
 * whether to stop.
 */
public class BackgroundAvailabilityService extends Service {

    private static final String TAG = "BadiyoBgSvc";

    /** Distinct low-importance channel — persistent status must be silent. */
    static final String STATUS_CHANNEL_ID = "expert_online_status";
    private static final int NOTIFICATION_ID = 4711;

    public static final String ACTION_START = "com.badiyo.expert.action.START_AVAILABILITY";
    public static final String ACTION_STOP = "com.badiyo.expert.action.STOP_AVAILABILITY";

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "onCreate");
        // Channel MUST exist before startForeground() on API 26+, otherwise
        // startForeground throws and the service dies silently.
        ensureStatusChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        Log.d(TAG, "onStartCommand action=" + action + " sdk=" + Build.VERSION.SDK_INT);

        // Contract-safe: promote to foreground FIRST on every invocation, then
        // decide whether to stop. Skipping this on the STOP path or the
        // "permission revoked" path would crash the process on Android 8+.
        try {
            Log.d(TAG, "calling startForeground");
            startForeground(NOTIFICATION_ID, buildStatusNotification());
            Log.d(TAG, "startForeground OK");
        } catch (Throwable t) {
            Log.e(TAG, "startForeground FAILED", t);
            stopSelf();
            return START_NOT_STICKY;
        }

        if (ACTION_STOP.equals(action)) {
            Log.d(TAG, "STOP requested — stopping self");
            stopSelfInternal();
            return START_NOT_STICKY;
        }

        // Guard: if background location permission was revoked between
        // start-request and the service actually starting, bail out cleanly —
        // but only AFTER startForeground() has satisfied the OS contract.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !hasBackgroundLocation()) {
            Log.w(TAG, "background location permission missing — stopping self");
            stopSelfInternal();
            return START_NOT_STICKY;
        }

        // START_STICKY so Android relaunches us if killed for memory pressure —
        // the expert opted in to background availability.
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "onDestroy");
        super.onDestroy();
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
        if (manager == null) {
            Log.w(TAG, "NotificationManager null — cannot create channel");
            return;
        }
        if (manager.getNotificationChannel(STATUS_CHANNEL_ID) != null) {
            Log.d(TAG, "status channel already exists");
            return;
        }

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
        Log.d(TAG, "status channel created");
    }

    private boolean hasBackgroundLocation() {
        return ContextCompat.checkSelfPermission(
            this, Manifest.permission.ACCESS_BACKGROUND_LOCATION
        ) == PackageManager.PERMISSION_GRANTED;
    }
}
