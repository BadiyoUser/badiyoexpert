// Utilities for the Home-screen broadcast experience.
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
// TEMPORARY: on-screen debug overlay for diagnosing Online-toggle hangs.
import { dlog } from "@/lib/debug-log";

export type Coords = { lat: number; lng: number };

// Haversine distance in km
export function haversineKm(a: Coords, b: Coords): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export type LocationState =
  | { status: "idle" }
  | { status: "requesting" }
  | { status: "denied" }
  | { status: "unavailable"; message: string }
  | { status: "ok"; coords: Coords; updatedAt: number };

export type LocationTracker = {
  state: LocationState;
  lastPushedAt: number | null;
  /** True when the page is currently hidden/backgrounded. Tracking is paused. */
  isHidden: boolean;
  /**
   * Imperatively request a fresh fix and persist it. Resolves with coords on
   * success, or throws with a user-readable message on failure. Callers should
   * await this before flipping the expert to Online so a booking broadcast
   * during the toggle gap doesn't miss the expert.
   */
  ensureFix: () => Promise<Coords>;
};

async function pushLocation(coords: Coords): Promise<void> {
  const { error } = await supabase.rpc("expert_update_location", {
    p_lat: coords.lat,
    p_lng: coords.lng,
  });
  if (error) {
    console.error("[expert] expert_update_location failed", error);
    throw new Error(error.message || "Could not save location");
  }
}

async function getNativeGeolocation() {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform?.()) return null;
    const { Geolocation } = await import("@capacitor/geolocation");
    return Geolocation;
  } catch {
    return null;
  }
}

async function ensureNativePermission(): Promise<void> {
  const Geo = await getNativeGeolocation();
  if (!Geo) { dlog("perm: web (no native plugin)"); return; }
  // Capacitor's own permission API — the OS-level grant is not enough; the
  // plugin also gates the call and will otherwise throw "application does
  // not have sufficient geolocation permissions".
  dlog("checkPermissions: start");
  let perm = await withTimeout(Geo.checkPermissions(), 8_000, "checkPermissions");
  dlog(`checkPermissions: ${perm.location}/${perm.coarseLocation}`);
  console.log("[expert][geo] checkPermissions →", perm);
  if (perm.location !== "granted" && perm.coarseLocation !== "granted") {
    dlog("requestPermissions: start");
    console.log("[expert][geo] requesting permissions…");
    perm = await withTimeout(
      Geo.requestPermissions({ permissions: ["location", "coarseLocation"] }),
      30_000,
      "requestPermissions",
    );
    dlog(`requestPermissions: ${perm.location}/${perm.coarseLocation}`);
    console.log("[expert][geo] requestPermissions →", perm);
  }
  if (perm.location !== "granted" && perm.coarseLocation !== "granted") {
    dlog("perm: DENIED");
    const err = new Error("Location permission denied") as Error & { code?: number };
    err.code = 1;
    throw err;
  }
}

// Hard timeout wrapper — the OS/Capacitor `timeout` option is not always
// honored on Android (some devices hang forever waiting for a GPS fix).
// This guarantees the promise settles so the UI can never get stuck.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      const err = new Error(`${label} timed out after ${ms}ms`) as Error & { code?: number };
      err.code = 3; // TIMEOUT
      reject(err);
    }, ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

async function getCurrentPositionOnce(): Promise<GeolocationPosition> {
  const Geo = await getNativeGeolocation();
  if (Geo) {
    await ensureNativePermission();
    console.log("[expert][geo] getCurrentPosition (native) start");
    try {
      const pos = await withTimeout(
        Geo.getCurrentPosition({
          enableHighAccuracy: true,
          maximumAge: 15_000,
          timeout: 15_000,
        }),
        15_000,
        "getCurrentPosition",
      );
      console.log("[expert][geo] getCurrentPosition (native) success");
      return pos as unknown as GeolocationPosition;
    } catch (err) {
      console.warn("[expert][geo] getCurrentPosition (native) failed", err);
      throw err;
    }
  }
  return withTimeout(
    new Promise<GeolocationPosition>((resolve, reject) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        reject(new Error("Geolocation not supported on this device."));
        return;
      }
      console.log("[expert][geo] getCurrentPosition (web) start");
      navigator.geolocation.getCurrentPosition(
        (pos) => { console.log("[expert][geo] getCurrentPosition (web) success"); resolve(pos); },
        (err) => { console.warn("[expert][geo] getCurrentPosition (web) error", err); reject(err); },
        { enableHighAccuracy: true, maximumAge: 15_000, timeout: 15_000 },
      );
    }),
    15_000,
    "getCurrentPosition",
  );
}

// Tracks device geolocation while `enabled` is true and pushes it to Supabase
// on every fresh reading plus a 60s poll. Also exposes `ensureFix()` for the
// caller to await a fresh persisted fix before flipping Online.
export function useExpertLocationTracking(enabled: boolean): LocationTracker {
  const [state, setState] = useState<LocationState>({ status: "idle" });
  const [lastPushedAt, setLastPushedAt] = useState<number | null>(null);
  const [isHidden, setIsHidden] = useState<boolean>(
    typeof document !== "undefined" ? document.hidden : false,
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const hiddenRef = useRef(isHidden);
  hiddenRef.current = isHidden;

  const applyPosition = useCallback((pos: GeolocationPosition) => {
    const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    setState({ status: "ok", coords, updatedAt: Date.now() });
    return coords;
  }, []);

  const applyError = useCallback((err: GeolocationPositionError | Error) => {
    // Suppress geolocation errors while backgrounded — browsers throttle or
    // time out watchPosition/getCurrentPosition when the tab is hidden, and
    // that's expected OS behavior, not a genuine failure.
    if (hiddenRef.current) return;
    if ("code" in err && err.code === err.PERMISSION_DENIED) {
      setState({ status: "denied" });
      return;
    }
    setState({
      status: "unavailable",
      message: (err as Error).message || "Location unavailable",
    });
  }, []);

  const ensureFix = useCallback(async (): Promise<Coords> => {
    setState((prev) => (prev.status === "ok" ? prev : { status: "requesting" }));
    try {
      const pos = await getCurrentPositionOnce();
      const coords = applyPosition(pos);
      await pushLocation(coords);
      setLastPushedAt(Date.now());
      return coords;
    } catch (err) {
      applyError(err as GeolocationPositionError | Error);
      const message =
        (err as GeolocationPositionError).code === 1
          ? "Location permission denied. Enable location access to receive bookings."
          : (err as Error).message || "Could not get your location";
      throw new Error(message);
    }
  }, [applyPosition, applyError]);

  // Track page visibility so we can pause tracking while hidden.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => setIsHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState({ status: "idle" });
      setLastPushedAt(null);
      return;
    }
    // Pause tracking while the tab is hidden — keep last-known state intact.
    if (isHidden) return;

    let cancelled = false;
    let clearWatch: (() => void) | null = null;
    let interval: number | null = null;

    const onPosition = (pos: GeolocationPosition) => {
      if (cancelled) return;
      const coords = applyPosition(pos);
      pushLocation(coords)
        .then(() => setLastPushedAt(Date.now()))
        .catch((err) => console.error("[expert] location push failed", err));
    };
    const onError = (err: GeolocationPositionError | Error) => {
      if (cancelled) return;
      applyError(err);
    };

    const pollOnce = () => {
      getCurrentPositionOnce().then(onPosition).catch(onError);
    };

    (async () => {
      const Geo = await getNativeGeolocation();
      if (cancelled) return;

      // Immediate refresh on enable/foreground.
      pollOnce();

      if (Geo) {
        try {
          await ensureNativePermission();
          const id = await Geo.watchPosition(
            { enableHighAccuracy: true, timeout: 20_000 },
            (pos, err) => {
              if (err) return onError(err);
              if (pos) onPosition(pos as unknown as GeolocationPosition);
            },
          );
          if (cancelled) {
            void Geo.clearWatch({ id });
          } else {
            clearWatch = () => void Geo.clearWatch({ id });
          }
        } catch (err) {
          onError(err as Error);
        }
      } else if (typeof navigator !== "undefined" && navigator.geolocation) {
        const id = navigator.geolocation.watchPosition(onPosition, onError, {
          enableHighAccuracy: true,
          maximumAge: 30_000,
          timeout: 20_000,
        });
        clearWatch = () => navigator.geolocation.clearWatch(id);
      } else {
        setState({ status: "unavailable", message: "Geolocation not supported on this device." });
        return;
      }

      interval = window.setInterval(pollOnce, 60_000);
    })();

    return () => {
      cancelled = true;
      if (clearWatch) clearWatch();
      if (interval !== null) window.clearInterval(interval);
    };
  }, [enabled, isHidden, applyPosition, applyError]);

  return { state, lastPushedAt, isHidden, ensureFix };
}

// -----------------------------------------------------------------------------
// Sound loop (Web Audio synth — no asset needed, matches the "notification loop"
// pattern used elsewhere in Badiyo).
// -----------------------------------------------------------------------------
let sharedCtx: AudioContext | null = null;
const activeSources = new Set<{ stop: () => void }>();

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!sharedCtx) sharedCtx = new AC();
  if (sharedCtx.state === "suspended") void sharedCtx.resume();
  return sharedCtx;
}

export function startNotificationLoop(): { stop: () => void } {
  const ctx = getCtx();
  if (!ctx) return { stop: () => {} };
  let stopped = false;
  let timer: number | null = null;

  const beep = () => {
    if (stopped) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.18);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  };

  beep();
  timer = window.setInterval(beep, 1400);

  const handle = {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (timer !== null) window.clearInterval(timer);
      activeSources.delete(handle);
    },
  };
  activeSources.add(handle);
  return handle;
}

export function stopAllNotificationLoops() {
  for (const s of Array.from(activeSources)) s.stop();
}
