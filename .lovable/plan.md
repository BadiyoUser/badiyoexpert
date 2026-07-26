## Problem

Overlay shows: `getNativeGeolocation: plugin loaded` → 20 s silence → outer safety-net timeout. The gap sits at exactly two lines of code (`if (Geo)` then `await ensureNativePermission()`), so we need finer instrumentation *at* that boundary and a parallel code path that bypasses `ensureNativePermission` entirely to prove where the hang lives.

## Code between "plugin loaded" and "ensureNativePermission: entry"

`src/lib/broadcast.ts` lines 147–152:

```
async function getCurrentPositionOnce() {
  dlog("getCurrentPositionOnce: entry");
  const Geo = await getNativeGeolocation();   // last log seen: "plugin loaded"
  if (Geo) {
    await ensureNativePermission();           // its first line: dlog("ensureNativePermission: entry") — NEVER APPEARS
    ...
```

Nothing else runs in between. That means one of three things is true, and this plan proves which:

1. The `await` microtask boundary itself is stuck (native bridge/JS thread stall).
2. `ensureNativePermission` is being entered but its `dlog("entry")` write is not reaching the overlay (stale bundle in the APK — the on-device JS predates the `entry` log).
3. A silent throw between them is swallowing execution (unlikely — no code exists there).

## Changes

### 1. Instrument the exact boundary in `src/lib/broadcast.ts`

Add dlog calls that are *impossible to skip* between the two known points:

```ts
const Geo = await getNativeGeolocation();
dlog(`post-getNativeGeolocation: Geo=${Geo ? "truthy" : "null"}`);
if (Geo) {
  dlog("about to call ensureNativePermission");
  try {
    await ensureNativePermission();
    dlog("ensureNativePermission returned OK");
  } catch (e) {
    dlog(`ensureNativePermission THREW: ${(e as Error).message}`);
    throw e;
  }
  ...
```

If `post-getNativeGeolocation` fires but `about to call ensureNativePermission` does not, the JS event loop itself is stalled at the await boundary (bridge-level issue).

If `about to call ensureNativePermission` fires but `ensureNativePermission: entry` still does not, the on-device bundle is stale (rebuild + `cap sync` needed) — because the code path physically cannot reach that line without executing the first line of `ensureNativePermission`.

### 2. Bypass `ensureNativePermission` entirely as a parallel test

Add a hard-timeout-wrapped direct `Geo.getCurrentPosition()` call that skips `checkPermissions`/`requestPermissions` completely, gated by a `SKIP_PERM_CHECK` constant at the top of the file (default `true` for this diagnostic build):

```ts
const SKIP_PERM_CHECK = true; // DIAGNOSTIC — remove after fix

if (Geo) {
  if (SKIP_PERM_CHECK) {
    dlog("SKIP_PERM_CHECK: calling getCurrentPosition directly");
    const pos = await hardTimeout(
      Geo.getCurrentPosition({ enableHighAccuracy: true, maximumAge: 15_000, timeout: 15_000 }),
      15_000,
      "getCurrentPosition(direct)",
    );
    dlog(`direct getCurrentPosition: ${pos.coords.latitude},${pos.coords.longitude}`);
    return pos as unknown as GeolocationPosition;
  }
  // else original ensureNativePermission path
}
```

This isolates the failure:

- If `direct getCurrentPosition` succeeds → the hang was in `checkPermissions`/`requestPermissions` and the plugin will just prompt the user itself on first `getCurrentPosition`. Fix: drop the explicit permissions dance entirely on Android and rely on `getCurrentPosition` to trigger the OS prompt.
- If it also hangs with `hardTimeout FIRED: getCurrentPosition(direct)` after 15 s → the bridge to the Geolocation plugin is broken end-to-end on this device (not a permissions issue). Fix path becomes: use `navigator.geolocation` (WebView native) instead of the Capacitor plugin on this OEM.
- If it hangs with **no** hard-timeout log → the JS event loop is frozen. Fix path becomes: investigate what other native call (StatusBar, Preferences, PushNotifications init) is holding the bridge at toggle time.

### 3. Report matrix

After the next device test, the overlay will fall into exactly one of these buckets and dictate the real fix:

```
A) post-getNativeGeolocation logs, "about to call" does NOT
   → JS event-loop stall. Investigate concurrent native calls.

B) "about to call" logs, "ensureNativePermission: entry" does NOT
   → Stale APK bundle. Rebuild + cap sync.

C) SKIP_PERM_CHECK path: "direct getCurrentPosition" succeeds
   → Permissions dance is the culprit. Remove it; let plugin auto-prompt.

D) SKIP_PERM_CHECK path: hardTimeout FIRES for getCurrentPosition(direct)
   → Capacitor Geolocation plugin bridge is broken on this device.
     Switch to navigator.geolocation on native.

E) SKIP_PERM_CHECK path: NO hardTimeout log, only outer 20s fires
   → JS event loop frozen. Same as (A).
```

## Files touched

- `src/lib/broadcast.ts` — add three dlogs at the boundary, add `SKIP_PERM_CHECK` diagnostic branch with `hardTimeout`-wrapped direct `getCurrentPosition`.

No other files change. The `<DebugOverlay />` and toggle handler stay as-is.

## After the fix is confirmed

Once the device test identifies which bucket (A–E) we're in and the real fix lands, remove `SKIP_PERM_CHECK`, the boundary dlogs, and (per earlier plan) the whole `debug-log.ts` + overlay.