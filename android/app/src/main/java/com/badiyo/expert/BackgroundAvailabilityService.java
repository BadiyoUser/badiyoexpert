package com.badiyo.expert;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationTokenSource;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Phase 3: Foreground service that keeps the expert "online" while the
 * app is backgrounded or killed, AND periodically pushes their location
 * to Supabase via a native HTTP call to expert_update_location.
 *
 * Android 8+ contract: startForeground() must be called within ~5s of
 * startForegroundService() on every entry, before any early-return.
 */
public class BackgroundAvailabilityService extends Service {

    private static final String TAG = "BadiyoBgSvc";

    static final String STATUS_CHANNEL_ID = "expert_online_status";
    private static final int NOTIFICATION_ID = 4711;

    public static final String ACTION_START = "com.badiyo.expert.action.START_AVAILABILITY";
    public static final String ACTION_STOP = "com.badiyo.expert.action.STOP_AVAILABILITY";

    // Battery-conscious: background is a safety-net, not primary tracking.
    private static final long LOCATION_INTERVAL_MS = 60_000L;

    // Must match src/integrations/supabase/client.ts + Capacitor Preferences.
    // Capacitor Preferences on Android writes to SharedPreferences file
    // "CapacitorStorage" with the raw key as-is.
    private static final String PREFS_NAME = "CapacitorStorage";
    private static final String SESSION_KEY = "sb-dkneclwmmjlqswovtqno-auth-token";
    private static final String SUPABASE_URL = "https://dkneclwmmjlqswovtqno.supabase.co";
    private static final String SUPABASE_ANON_KEY =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrbmVjbHdtbWpscXN3b3Z0cW5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4OTExMjMsImV4cCI6MjEwMDQ2NzEyM30.5wHGl9oFmY2AJysu9KlTpUwb-HQGtZZ6q-SHi1ced1Q";

    private FusedLocationProviderClient fused;
    private ScheduledExecutorService scheduler;
    private ScheduledFuture<?> cycleFuture;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "onCreate");
        ensureStatusChannel();
        fused = LocationServices.getFusedLocationProviderClient(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        Log.d(TAG, "onStartCommand action=" + action + " sdk=" + Build.VERSION.SDK_INT);

        // Contract-safe: promote to foreground FIRST on every invocation.
        try {
            startForeground(NOTIFICATION_ID, buildStatusNotification());
            Log.d(TAG, "startForeground OK");
        } catch (Throwable t) {
            Log.e(TAG, "startForeground FAILED", t);
            stopSelf();
            return START_NOT_STICKY;
        }

        if (ACTION_STOP.equals(action)) {
            Log.d(TAG, "STOP requested — stopping self");
            stopLocationCycle();
            stopSelfInternal();
            return START_NOT_STICKY;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !hasBackgroundLocation()) {
            Log.w(TAG, "background location permission missing — stopping self");
            stopSelfInternal();
            return START_NOT_STICKY;
        }

        startLocationCycle();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "onDestroy");
        stopLocationCycle();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ------------------- Location cycle -------------------

    private void startLocationCycle() {
        if (scheduler != null && !scheduler.isShutdown()) {
            Log.d(TAG, "location cycle already running");
            return;
        }
        Log.d(TAG, "starting location cycle every " + LOCATION_INTERVAL_MS + "ms");
        scheduler = Executors.newSingleThreadScheduledExecutor();
        cycleFuture = scheduler.scheduleWithFixedDelay(
            this::runOneCycleSafe, 0L, LOCATION_INTERVAL_MS, TimeUnit.MILLISECONDS
        );
    }

    private void stopLocationCycle() {
        if (cycleFuture != null) {
            cycleFuture.cancel(true);
            cycleFuture = null;
        }
        if (scheduler != null) {
            scheduler.shutdownNow();
            scheduler = null;
        }
        Log.d(TAG, "location cycle stopped");
    }

    private void runOneCycleSafe() {
        try {
            runOneCycle();
        } catch (Throwable t) {
            // Never let a cycle exception kill the ScheduledExecutorService.
            Log.e(TAG, "cycle failed (swallowed)", t);
        }
    }

    @SuppressLint("MissingPermission")
    private void runOneCycle() {
        if (!hasForegroundLocation()) {
            Log.w(TAG, "cycle skipped — no fine location permission");
            return;
        }
        CancellationTokenSource cts = new CancellationTokenSource();
        fused.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, cts.getToken())
            .addOnSuccessListener(loc -> {
                if (loc == null) {
                    Log.w(TAG, "getCurrentLocation returned null");
                    return;
                }
                Log.d(TAG, "fix lat=" + loc.getLatitude() + " lng=" + loc.getLongitude()
                    + " acc=" + loc.getAccuracy());
                // Do the HTTP POST off the main thread.
                if (scheduler != null && !scheduler.isShutdown()) {
                    scheduler.execute(() -> pushLocationSafe(loc));
                }
            })
            .addOnFailureListener(err -> Log.e(TAG, "getCurrentLocation failed", err));
    }

    private void pushLocationSafe(Location loc) {
        try {
            String token = readAccessToken();
            if (token == null) {
                Log.w(TAG, "no access token in Preferences — skip push");
                return;
            }
            postExpertUpdateLocation(token, loc.getLatitude(), loc.getLongitude());
        } catch (Throwable t) {
            Log.e(TAG, "pushLocation failed (swallowed)", t);
        }
    }

    /** Reads Supabase session JSON from Capacitor Preferences and returns access_token. */
    private String readAccessToken() {
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String raw = prefs.getString(SESSION_KEY, null);
            if (raw == null) {
                Log.w(TAG, "no session json under " + SESSION_KEY);
                return null;
            }
            JSONObject obj = new JSONObject(raw);
            String access = obj.optString("access_token", null);
            if (access == null || access.isEmpty()) {
                Log.w(TAG, "session json missing access_token");
                return null;
            }
            return access;
        } catch (Throwable t) {
            Log.e(TAG, "readAccessToken failed", t);
            return null;
        }
    }

    private void postExpertUpdateLocation(String accessToken, double lat, double lng) throws Exception {
        URL url = new URL(SUPABASE_URL + "/rest/v1/rpc/expert_update_location");
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        try {
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(15_000);
            conn.setReadTimeout(15_000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("apikey", SUPABASE_ANON_KEY);
            conn.setRequestProperty("Authorization", "Bearer " + accessToken);

            JSONObject body = new JSONObject();
            body.put("p_lat", lat);
            body.put("p_lng", lng);
            byte[] payload = body.toString().getBytes("UTF-8");

            try (OutputStream os = conn.getOutputStream()) {
                os.write(payload);
            }

            int code = conn.getResponseCode();
            if (code >= 200 && code < 300) {
                Log.d(TAG, "expert_update_location OK (" + code + ")");
            } else {
                String err = readStream(conn.getErrorStream());
                Log.e(TAG, "expert_update_location HTTP " + code + " body=" + err);
            }
        } finally {
            conn.disconnect();
        }
    }

    private String readStream(InputStream is) {
        if (is == null) return "";
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(is, "UTF-8"))) {
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
        } catch (Throwable ignored) {}
        return sb.toString();
    }

    // ------------------- Lifecycle helpers -------------------

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

        Notification n = new NotificationCompat.Builder(this, STATUS_CHANNEL_ID)
            .setContentTitle("badiyos Expert — Online")
            .setContentText("You're receiving nearby job alerts")
            .setSmallIcon(android.R.drawable.presence_online)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(contentIntent)
            .build();
        n.flags |= Notification.FLAG_ONGOING_EVENT | Notification.FLAG_NO_CLEAR;
        return n;
    }

    private void ensureStatusChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            Log.w(TAG, "NotificationManager null — cannot create channel");
            return;
        }
        if (manager.getNotificationChannel(STATUS_CHANNEL_ID) != null) return;

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

    private boolean hasForegroundLocation() {
        return ContextCompat.checkSelfPermission(
            this, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasBackgroundLocation() {
        return ContextCompat.checkSelfPermission(
            this, Manifest.permission.ACCESS_BACKGROUND_LOCATION
        ) == PackageManager.PERMISSION_GRANTED;
    }
}
