// lib/notifications.ts
//
// Order alerts for the dashboard: an in-browser generated alert tone
// (Web Audio oscillator — no audio file to host) and native browser
// Notification()s. Both only work while this tab is open (even if
// backgrounded/minimized) — there's no service worker or push
// subscription storage here, so this can't wake a closed browser. See
// requestOrderAlerts() for the permission/unlock step that has to run
// from a real user click before any of this works reliably.

let audioCtx: AudioContext | null = null;

// Browsers block audio/autoplay until a real user gesture has happened
// on the page at least once. Call this from a click handler (the
// "Enable Alerts" button) — it both creates the AudioContext and plays
// a quiet confirmation blip, which satisfies that gesture requirement
// so later programmatic calls (from a polling timer, no gesture) work.
export function unlockAudio(): void {
  if (audioCtx) return;
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return;
  audioCtx = new Ctx();
  playTone(audioCtx, 880, 0.08, 0.15);
}

function playTone(ctx: AudioContext, freq: number, duration: number, volume: number, delay = 0) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.value = volume;
  osc.connect(gain);
  gain.connect(ctx.destination);
  const start = ctx.currentTime + delay;
  osc.start(start);
  osc.stop(start + duration);
}

// Loud, attention-grabbing double-beep for a new order — deliberately
// more urgent than the quiet confirmation blip unlockAudio() plays.
export function playNewOrderAlert(): void {
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") audioCtx.resume();
  playTone(audioCtx, 1046, 0.18, 0.5, 0);
  playTone(audioCtx, 1318, 0.22, 0.5, 0.22);
}

export type NotificationPermissionState = "unsupported" | "default" | "granted" | "denied";

export function getNotificationPermission(): NotificationPermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as NotificationPermissionState;
}

// Requests OS-level notification permission. Must be called from a user
// gesture (click) — browsers ignore/auto-deny permission requests fired
// programmatically without one.
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  const result = await Notification.requestPermission();
  return result as NotificationPermissionState;
}

export function showNewOrderNotification(summary: string, onClick?: () => void): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const n = new Notification("New Meal Bear order", {
    body: summary,
    tag: "meal-bear-new-order", // replaces any still-open prior notification instead of stacking
    requireInteraction: true, // stays on screen until dismissed, doesn't auto-vanish
  });
  if (onClick) {
    n.onclick = () => {
      window.focus();
      onClick();
    };
  }
}