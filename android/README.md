# Android native setup (not committed)

The `android/` folder is generated locally with `npx cap add android`. After
generation, copy in the tracked files below and edit `AndroidManifest.xml`
manually — these are the only pieces the repo owns:

## Tracked Java sources
- `android/app/src/main/java/com/badiyo/expert/MainActivity.java`
- `android/app/src/main/java/com/badiyo/expert/BackgroundLocationPlugin.java`
- `android/app/src/main/java/com/badiyo/expert/BackgroundAvailabilityService.java`
- `android/app/src/main/java/com/badiyo/expert/BadiyoMessagingService.java`
- `android/app/src/main/java/com/badiyo/expert/BookingRingActivity.java`
- `android/app/src/main/java/com/badiyo/expert/BookingAlertActions.java`
- `android/app/src/main/java/com/badiyo/expert/SupabaseRpc.java`
- `android/app/src/main/res/layout/activity_booking_ring.xml`

## Required manifest edits (`android/app/src/main/AndroidManifest.xml`)

Add inside `<manifest>` alongside the existing `ACCESS_FINE_LOCATION` /
`ACCESS_COARSE_LOCATION` permissions:

```xml
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
```

Add inside `<application>` (FCM default channel — matches the channel created
in `MainActivity.createNewBookingNotificationChannel`):

```xml
<meta-data
  android:name="com.google.firebase.messaging.default_notification_channel_id"
  android:value="new_booking_alerts" />
```

Also add inside `<application>` — declares the Phase 2 background availability
foreground service. `foregroundServiceType="location"` is required on
Android 10+ for any foreground service that will use location (Phase 3):

```xml
<service
  android:name=".BackgroundAvailabilityService"
  android:exported="false"
  android:foregroundServiceType="location" />
```

After any change here, run:

```bash
npx cap sync android
cd android && ./gradlew assembleDebug
```

## Required Gradle dependency (`android/app/build.gradle`)

Phase 3 uses Google Play services location (`FusedLocationProviderClient`)
inside `BackgroundAvailabilityService` to poll the expert's position every
60s while the app is closed. Add to the `dependencies { ... }` block:

```gradle
implementation "com.google.android.gms:play-services-location:21.3.0"
```

Then re-sync Gradle. No Google Maps API key is required for the location
API — only the `google-services.json` already present for FCM.



---

# MANUAL MERGE BLOCK — full-screen ringing booking alert

Apply this by hand to `android/app/src/main/AndroidManifest.xml` after
`npx cap sync android`. Everything below is additive; nothing gets removed.

## 1. Permissions — add inside `<manifest>`

```xml
<uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />
<uses-permission android:name="android.permission.VIBRATE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.DISABLE_KEYGUARD" />
```

## 2. Add inside `<application>`

```xml
<!-- Full-screen ringing alert screen (shows over the lockscreen) -->
<activity
    android:name=".BookingRingActivity"
    android:exported="false"
    android:launchMode="singleTask"
    android:excludeFromRecents="true"
    android:taskAffinity="com.badiyo.expert.ring"
    android:showOnLockScreen="true"
    android:turnScreenOn="true"
    android:showWhenLocked="true"
    android:screenOrientation="portrait"
    android:theme="@android:style/Theme.DeviceDefault.NoActionBar" />

<!-- Accept / Reject notification-action receiver -->
<receiver
    android:name=".BookingAlertActions"
    android:exported="false" />

<!-- Our FCM service MUST be declared BEFORE (or instead of) the Capacitor
     plugin's own MessagingService entry so it wins the intent-filter match.
     It extends the Capacitor service, so JS push events still fire. -->
<service
    android:name=".BadiyoMessagingService"
    android:exported="false"
    android:directBootAware="true">
    <intent-filter android:priority="1">
        <action android:name="com.google.firebase.MESSAGING_EVENT" />
    </intent-filter>
</service>
```

If `npx cap sync` injects a
`com.capacitorjs.plugins.pushnotifications.MessagingService` entry, REMOVE that
`<service>` block (or delete only its `<intent-filter>`); two services matching
`MESSAGING_EVENT` means Android picks one arbitrarily.

The existing meta-data line stays as-is and is what makes any fallback OS-built
notification land on the loud channel:

```xml
<meta-data
    android:name="com.google.firebase.messaging.default_notification_channel_id"
    android:value="new_booking_alerts" />
```

## 3. Alert sound (optional but recommended)

Drop any short looping audio file at:

```
android/app/src/main/res/raw/booking_alert.mp3   (or .ogg / .wav)
```

Name it exactly `booking_alert`. If the file is absent, `BookingRingActivity`
automatically falls back to the device's default ringtone — no crash, no build
error. Note the notification channel's own sound is fixed at creation time; to
make the *channel* use a custom sound you must uninstall/reinstall the app (or
bump the channel ID), because Android freezes channel settings after creation.

## 4. Android 14+ (API 34) caveat

`USE_FULL_SCREEN_INTENT` is auto-granted only to apps whose primary function is
calling or alarms. For other apps the user must enable it manually under
Settings → Apps → Badiyo Expert → "Allow full-screen notifications". Without it
Android downgrades the alert to a loud heads-up notification (still rings via
`FLAG_INSISTENT`, but does not wake the lockscreen). Consider prompting the
expert once via `Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT`.

Also whitelist the app from battery optimisation / enable autostart on
Xiaomi, Oppo, Vivo, Realme and Samsung — otherwise the process can be frozen
and no FCM data message is delivered at all.
