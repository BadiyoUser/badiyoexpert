# Android native setup (not committed)

The `android/` folder is generated locally with `npx cap add android`. After
generation, copy in the tracked files below and edit `AndroidManifest.xml`
manually — these are the only pieces the repo owns:

## Tracked Java sources
- `android/app/src/main/java/com/badiyo/expert/MainActivity.java`
- `android/app/src/main/java/com/badiyo/expert/BackgroundLocationPlugin.java`
- `android/app/src/main/java/com/badiyo/expert/BackgroundAvailabilityService.java`

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
