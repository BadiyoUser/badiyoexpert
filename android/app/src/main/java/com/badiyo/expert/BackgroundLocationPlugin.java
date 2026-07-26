package com.badiyo.expert;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.Permission;
import androidx.core.content.ContextCompat;

/**
 * Custom Capacitor plugin to handle Android's 2-step background location
 * permission flow (ACCESS_BACKGROUND_LOCATION).
 *
 * Android 10 (API 29): can request ACCESS_BACKGROUND_LOCATION directly.
 * Android 11+ (API 30+): OS forbids in-app request; user MUST toggle
 *   "Allow all the time" from the app's system Settings page.
 *
 * Register in MainActivity via registerPlugin(BackgroundLocationPlugin.class).
 */
@CapacitorPlugin(
    name = "BackgroundLocation",
    permissions = {
        @Permission(
            alias = "backgroundLocation",
            strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }
        )
    }
)
public class BackgroundLocationPlugin extends Plugin {

    @PluginMethod
    public void check(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("foreground", hasForegroundLocation());
        ret.put("background", hasBackgroundLocation());
        ret.put("sdkInt", Build.VERSION.SDK_INT);
        ret.put("mustUseSettings", Build.VERSION.SDK_INT >= Build.VERSION_CODES.R);
        call.resolve(ret);
    }

    @PluginMethod
    public void request(PluginCall call) {
        if (!hasForegroundLocation()) {
            JSObject ret = new JSObject();
            ret.put("granted", false);
            ret.put("reason", "foreground_not_granted");
            call.resolve(ret);
            return;
        }
        if (hasBackgroundLocation()) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        // Android 10: system will show the in-app dialog.
        // Android 11+: system dialog cannot request "Allow all the time" —
        // caller should instead invoke openSettings().
        if (Build.VERSION.SDK_INT == Build.VERSION_CODES.Q) {
            requestPermissionForAlias("backgroundLocation", call, "bgPermCallback");
        } else {
            JSObject ret = new JSObject();
            ret.put("granted", false);
            ret.put("reason", "must_open_settings");
            call.resolve(ret);
        }
    }

    @PermissionCallback
    private void bgPermCallback(PluginCall call) {
        JSObject ret = new JSObject();
        boolean granted = getPermissionState("backgroundLocation") == PermissionState.GRANTED;
        ret.put("granted", granted);
        if (!granted) ret.put("reason", "denied");
        call.resolve(ret);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    private boolean hasForegroundLocation() {
        return ContextCompat.checkSelfPermission(
            getContext(), Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasBackgroundLocation() {
        // Below Android 10 (API 29) there is no separate background permission —
        // foreground grant implicitly covers background use.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return hasForegroundLocation();
        return ContextCompat.checkSelfPermission(
            getContext(), Manifest.permission.ACCESS_BACKGROUND_LOCATION
        ) == PackageManager.PERMISSION_GRANTED;
    }
}
