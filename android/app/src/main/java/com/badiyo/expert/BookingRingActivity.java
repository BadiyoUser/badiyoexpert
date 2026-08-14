package com.badiyo.expert;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;

/**
 * Full-screen "incoming job" screen, launched by the full-screen intent from
 * {@link BadiyoMessagingService}. Shows over the lockscreen, turns the screen
 * on, rings a looping sound + vibration, and auto-dismisses after the
 * dispatch timeout (dispatch_config.radius_expand_after_seconds, delivered in
 * the push payload as timeout_seconds; defaults to 60s).
 *
 * On timeout this device simply stops ringing — the backend dispatcher expands
 * the search radius on its own schedule, so no call-back is needed.
 *
 * Alert sound: uses res/raw/booking_alert (any audio file with that name) when
 * present, otherwise falls back to the device's default ringtone.
 */
public class BookingRingActivity extends Activity {

    private static final String TAG = "BadiyoRing";

    public static final String EXTRA_BOOKING_ID = "booking_id";
    public static final String EXTRA_ALERT_TYPE = "alert_type";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_BODY = "body";
    public static final String EXTRA_ADDRESS = "address";
    public static final String EXTRA_DURATION = "duration";
    public static final String EXTRA_TIMEOUT = "timeout_seconds";

    private static final String ACTION_DISMISS = "com.badiyo.expert.action.RING_DISMISS";

    private String bookingId = "";
    private MediaPlayer player;
    private Vibrator vibrator;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable timeoutTask;
    private Runnable tickTask;
    private long endsAtMs;
    private TextView countdownView;
    private BroadcastReceiver dismissReceiver;

    /** Asks a showing ring screen (for this booking, or any) to close itself. */
    static void dismissIfShowing(Context appCtx, String bookingId) {
        Intent i = new Intent(ACTION_DISMISS);
        i.setPackage(appCtx.getPackageName());
        i.putExtra(EXTRA_BOOKING_ID, bookingId == null ? "" : bookingId);
        appCtx.sendBroadcast(i);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        showOverLockscreen();
        setContentView(R.layout.activity_booking_ring);

        applyIntent(getIntent());

        dismissReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String id = intent.getStringExtra(EXTRA_BOOKING_ID);
                if (id == null || id.isEmpty() || id.equals(bookingId)) finishRing();
            }
        };
        IntentFilter filter = new IntentFilter(ACTION_DISMISS);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(dismissReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(dismissReceiver, filter);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        applyIntent(intent);
    }

    private void applyIntent(Intent intent) {
        if (intent == null) return;
        bookingId = str(intent.getStringExtra(EXTRA_BOOKING_ID));
        String title = str(intent.getStringExtra(EXTRA_TITLE));
        String body = str(intent.getStringExtra(EXTRA_BODY));
        String address = str(intent.getStringExtra(EXTRA_ADDRESS));
        String duration = str(intent.getStringExtra(EXTRA_DURATION));
        int timeout = intent.getIntExtra(EXTRA_TIMEOUT, 60);
        if (timeout <= 0) timeout = 60;

        TextView titleView = findViewById(R.id.ring_title);
        TextView subtitleView = findViewById(R.id.ring_subtitle);
        TextView addressView = findViewById(R.id.ring_address);
        countdownView = findViewById(R.id.ring_countdown);

        titleView.setText(title.isEmpty() ? "New booking" : title);
        subtitleView.setText(duration.isEmpty() ? body : duration);
        addressView.setText(address.isEmpty() ? body : address);

        Button accept = findViewById(R.id.ring_accept);
        Button reject = findViewById(R.id.ring_reject);
        accept.setOnClickListener(v -> {
            stopRinging();
            BadiyoMessagingService.cancelRingNotification(getApplicationContext());
            BookingAlertActions.claimAsync(getApplicationContext(), bookingId);
            finishRing();
        });
        reject.setOnClickListener(v -> {
            // Silent local dismiss — no backend reject action exists today.
            BadiyoMessagingService.cancelRingNotification(getApplicationContext());
            finishRing();
        });

        startRinging();
        startCountdown(timeout);
    }

    // ---------------- lockscreen / screen wake ----------------

    @SuppressWarnings("deprecation")
    private void showOverLockscreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = getSystemService(KeyguardManager.class);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    // ---------------- sound + vibration ----------------

    private void startRinging() {
        if (player != null) return;
        try {
            Uri sound = customAlertUri();
            if (sound == null) {
                sound = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_RINGTONE);
            }
            if (sound == null) {
                sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }
            player = new MediaPlayer();
            player.setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            );
            player.setDataSource(this, sound);
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Throwable t) {
            Log.e(TAG, "ring sound failed", t);
        }

        try {
            AudioManager am = getSystemService(AudioManager.class);
            boolean silent = am != null && am.getRingerMode() == AudioManager.RINGER_MODE_SILENT;
            vibrator = getSystemService(Vibrator.class);
            if (vibrator != null && vibrator.hasVibrator() && !silent) {
                long[] pattern = { 0, 700, 400, 700, 400 };
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                } else {
                    //noinspection deprecation
                    vibrator.vibrate(pattern, 0);
                }
            }
        } catch (Throwable t) {
            Log.e(TAG, "vibration failed", t);
        }
    }

    /** res/raw/booking_alert.* if the app ships one, else null. */
    private Uri customAlertUri() {
        int resId = getResources().getIdentifier("booking_alert", "raw", getPackageName());
        if (resId == 0) return null;
        return Uri.parse("android.resource://" + getPackageName() + "/" + resId);
    }

    private void stopRinging() {
        try {
            if (player != null) {
                if (player.isPlaying()) player.stop();
                player.release();
            }
        } catch (Throwable ignored) {
        } finally {
            player = null;
        }
        try {
            if (vibrator != null) vibrator.cancel();
        } catch (Throwable ignored) {
        } finally {
            vibrator = null;
        }
    }

    // ---------------- countdown / timeout ----------------

    private void startCountdown(int seconds) {
        if (timeoutTask != null) handler.removeCallbacks(timeoutTask);
        if (tickTask != null) handler.removeCallbacks(tickTask);

        endsAtMs = System.currentTimeMillis() + seconds * 1000L;

        tickTask = new Runnable() {
            @Override
            public void run() {
                long left = Math.max(0, (endsAtMs - System.currentTimeMillis()) / 1000L);
                if (countdownView != null) {
                    countdownView.setText("Expires in " + left + "s");
                }
                if (left > 0) handler.postDelayed(this, 1000L);
            }
        };
        handler.post(tickTask);

        timeoutTask = () -> {
            Log.d(TAG, "ring timed out for booking=" + bookingId);
            BadiyoMessagingService.cancelRingNotification(getApplicationContext());
            finishRing();
        };
        handler.postDelayed(timeoutTask, seconds * 1000L);
    }

    private void finishRing() {
        stopRinging();
        handler.removeCallbacksAndMessages(null);
        finish();
    }

    @Override
    protected void onDestroy() {
        stopRinging();
        handler.removeCallbacksAndMessages(null);
        if (dismissReceiver != null) {
            try {
                unregisterReceiver(dismissReceiver);
            } catch (Throwable ignored) {}
            dismissReceiver = null;
        }
        super.onDestroy();
    }

    private static String str(String s) {
        return s == null ? "" : s;
    }
}
