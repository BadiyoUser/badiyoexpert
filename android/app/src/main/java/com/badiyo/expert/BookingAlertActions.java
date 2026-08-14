package com.badiyo.expert;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.concurrent.Executors;

/**
 * Handles the Accept / Reject actions from the full-screen booking alert —
 * both the notification action buttons and the on-screen buttons in
 * {@link BookingRingActivity}.
 *
 * Accept  -> calls the same SECURITY DEFINER RPC the in-app Accept button
 *            uses (claim_booking_as_expert), then opens the app.
 * Reject  -> purely local dismiss. This matches current app behaviour: a
 *            reject is not a formal action anywhere in the Expert app today
 *            (the in-app card's "Dismiss" only removes the card locally);
 *            dispatch simply expands the radius on its own timer.
 */
public class BookingAlertActions extends BroadcastReceiver {

    private static final String TAG = "BadiyoAlertAction";

    public static final String ACTION_ACCEPT = "com.badiyo.expert.action.ALERT_ACCEPT";
    public static final String ACTION_REJECT = "com.badiyo.expert.action.ALERT_REJECT";
    public static final String EXTRA_BOOKING_ID = "booking_id";

    static Intent acceptIntent(Context ctx, String bookingId) {
        Intent i = new Intent(ctx, BookingAlertActions.class);
        i.setAction(ACTION_ACCEPT);
        i.putExtra(EXTRA_BOOKING_ID, bookingId);
        return i;
    }

    static Intent rejectIntent(Context ctx, String bookingId) {
        Intent i = new Intent(ctx, BookingAlertActions.class);
        i.setAction(ACTION_REJECT);
        i.putExtra(EXTRA_BOOKING_ID, bookingId);
        return i;
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        String bookingId = intent != null ? intent.getStringExtra(EXTRA_BOOKING_ID) : null;
        Log.d(TAG, "action=" + action + " booking=" + bookingId);

        // Stop the ringing UI/sound immediately for both actions.
        BadiyoMessagingService.cancelRingNotification(context.getApplicationContext());
        BookingRingActivity.dismissIfShowing(context.getApplicationContext(), bookingId);

        if (ACTION_ACCEPT.equals(action) && bookingId != null && !bookingId.isEmpty()) {
            claimAsync(context.getApplicationContext(), bookingId);
        }
        // Reject: nothing else to do — silent local dismiss.
    }

    /** Fire-and-forget claim on a worker thread, then open the app on success. */
    static void claimAsync(final Context appCtx, final String bookingId) {
        Executors.newSingleThreadExecutor().execute(() -> {
            SupabaseRpc.Result res;
            try {
                JSONObject params = new JSONObject();
                params.put("p_booking_id", bookingId);
                res = SupabaseRpc.call(appCtx, "claim_booking_as_expert", params);
            } catch (Throwable t) {
                Log.e(TAG, "claim failed", t);
                res = new SupabaseRpc.Result(false, 0, String.valueOf(t.getMessage()));
            }

            final boolean ok = res.ok;
            final String body = res.body;
            new Handler(Looper.getMainLooper()).post(() -> {
                if (ok) {
                    openApp(appCtx, "/booking/" + bookingId);
                } else {
                    // Already claimed by someone else, session expired, etc.
                    Toast.makeText(
                        appCtx,
                        "Could not accept this booking. Open the app to retry.",
                        Toast.LENGTH_LONG
                    ).show();
                    Log.w(TAG, "claim rejected: " + body);
                    openApp(appCtx, "/home");
                }
            });
        });
    }

    static void openApp(Context appCtx, String route) {
        Intent open = new Intent(appCtx, MainActivity.class);
        open.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
        );
        open.putExtra(MainActivity.EXTRA_ROUTE, route);
        appCtx.startActivity(open);
    }
}
