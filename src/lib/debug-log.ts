// TEMPORARY debug log store — powers the on-screen overlay used to diagnose
// the Online-toggle hang on native Android. Remove this file together with
// the <DebugOverlay /> usage in src/routes/home.tsx once the bug is fixed.
import { useEffect, useState } from "react";

type Listener = (lines: string[]) => void;
const lines: string[] = [];
const listeners = new Set<Listener>();

export function dlog(msg: string) {
  const stamp = new Date().toISOString().slice(11, 19);
  const line = `[${stamp}] ${msg}`;
  lines.push(line);
  if (lines.length > 60) lines.shift();
  // Mirror to console for good measure
  // eslint-disable-next-line no-console
  console.log("[dbg]", line);
  listeners.forEach((l) => l(lines.slice()));
}

export function dclear() {
  lines.length = 0;
  listeners.forEach((l) => l([]));
}

export function useDebugLog() {
  const [snapshot, setSnapshot] = useState<string[]>(() => lines.slice());
  useEffect(() => {
    const l: Listener = (next) => setSnapshot(next);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return snapshot;
}
