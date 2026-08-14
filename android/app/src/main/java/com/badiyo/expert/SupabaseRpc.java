package com.badiyo.expert;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Minimal native Supabase PostgREST RPC caller.
 *
 * Mirrors the auth-token handling already used by
 * {@link BackgroundAvailabilityService}: the Supabase session JSON is read
 * from Capacitor Preferences (SharedPreferences file "CapacitorStorage"),
 * and the access_token is sent as the bearer so RLS / SECURITY DEFINER RPCs
 * run as the signed-in expert. No service-role key ever lives on the device.
 */
final class SupabaseRpc {

    private static final String TAG = "BadiyoRpc";

    private static final String PREFS_NAME = "CapacitorStorage";
    private static final String SESSION_KEY = "sb-dkneclwmmjlqswovtqno-auth-token";
    private static final String SUPABASE_URL = "https://dkneclwmmjlqswovtqno.supabase.co";
    private static final String SUPABASE_ANON_KEY =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrbmVjbHdtbWpscXN3b3Z0cW5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4OTExMjMsImV4cCI6MjEwMDQ2NzEyM30.5wHGl9oFmY2AJysu9KlTpUwb-HQGtZZ6q-SHi1ced1Q";

    private SupabaseRpc() {}

    static String readAccessToken(Context ctx) {
        try {
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String raw = prefs.getString(SESSION_KEY, null);
            if (raw == null) return null;
            JSONObject obj = new JSONObject(raw);
            String access = obj.optString("access_token", null);
            return (access == null || access.isEmpty()) ? null : access;
        } catch (Throwable t) {
            Log.e(TAG, "readAccessToken failed", t);
            return null;
        }
    }

    /** Result of an RPC call. {@link #ok} is true for any 2xx response. */
    static final class Result {
        final boolean ok;
        final int status;
        final String body;

        Result(boolean ok, int status, String body) {
            this.ok = ok;
            this.status = status;
            this.body = body;
        }
    }

    /** Blocking POST to /rest/v1/rpc/{fn}. Never call from the main thread. */
    static Result call(Context ctx, String fn, JSONObject params) {
        String token = readAccessToken(ctx);
        if (token == null) {
            Log.w(TAG, "no access token — cannot call " + fn);
            return new Result(false, 401, "no session");
        }
        HttpURLConnection conn = null;
        try {
            URL url = new URL(SUPABASE_URL + "/rest/v1/rpc/" + fn);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(15_000);
            conn.setReadTimeout(15_000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("apikey", SUPABASE_ANON_KEY);
            conn.setRequestProperty("Authorization", "Bearer " + token);

            try (OutputStream os = conn.getOutputStream()) {
                os.write((params == null ? new JSONObject() : params).toString().getBytes("UTF-8"));
            }

            int code = conn.getResponseCode();
            String body = code >= 200 && code < 300
                ? readStream(conn.getInputStream())
                : readStream(conn.getErrorStream());
            if (code < 200 || code >= 300) {
                Log.e(TAG, fn + " HTTP " + code + " body=" + body);
            }
            return new Result(code >= 200 && code < 300, code, body);
        } catch (Throwable t) {
            Log.e(TAG, fn + " failed", t);
            return new Result(false, 0, String.valueOf(t.getMessage()));
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String readStream(InputStream is) {
        if (is == null) return "";
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(is, "UTF-8"))) {
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
        } catch (Throwable ignored) {}
        return sb.toString();
    }
}
