import type { ChronicleSaveV2 } from "@hnk/save-contract/v2";
import {
  createErrorTelemetry,
  createPerformanceTelemetry,
  createTelemetryEvent,
  emitAll,
  observeChronicleTransition,
  type TelemetryEnvelope,
  type TelemetrySink,
} from "@hnk/telemetry-engine";

const BUFFER_KEY = "hnk.telemetry.buffer.v1";
const SESSION_KEY = "hnk.telemetry.session.v1";
const MAX_BUFFER = 250;

function env(name: string): string | undefined {
  const meta = import.meta as ImportMeta & { env?: Record<string, string | undefined> };
  return meta.env?.[name];
}

function makeSessionId(): string {
  if (typeof sessionStorage !== "undefined") {
    const current = sessionStorage.getItem(SESSION_KEY);
    if (current) return current;
  }
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `session.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 9)}`;
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem(SESSION_KEY, id);
  return id;
}

function readBuffer(): TelemetryEnvelope[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(BUFFER_KEY);
    return raw ? (JSON.parse(raw) as TelemetryEnvelope[]).slice(-MAX_BUFFER) : [];
  } catch { return []; }
}

function writeBuffer(events: readonly TelemetryEnvelope[]): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(BUFFER_KEY, JSON.stringify(events.slice(-MAX_BUFFER))); } catch { /* telemetry must never break gameplay */ }
}

export class BrowserTelemetrySink implements TelemetrySink {
  private queue: TelemetryEnvelope[] = readBuffer();
  private flushing = false;
  private readonly endpoint = env("VITE_HNK_TELEMETRY_ENDPOINT");

  emit(event: TelemetryEnvelope): void {
    this.queue.push(event);
    if (this.queue.length > MAX_BUFFER) this.queue.splice(0, this.queue.length - MAX_BUFFER);
    writeBuffer(this.queue);
    if (this.queue.length >= 10) void this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0 || !this.endpoint) return;
    this.flushing = true;
    const batch = this.queue.slice(0, 50);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schemaVersion: 1, events: batch }),
        keepalive: true,
      });
      if (!response.ok) return;
      this.queue.splice(0, batch.length);
      writeBuffer(this.queue);
    } catch {
      // Preserve buffer for a later attempt.
    } finally {
      this.flushing = false;
    }
  }

  flushBeacon(): void {
    if (!this.endpoint || this.queue.length === 0 || typeof navigator === "undefined" || !("sendBeacon" in navigator)) return;
    const batch = this.queue.slice(0, 50);
    const sent = navigator.sendBeacon(this.endpoint, new Blob([JSON.stringify({ schemaVersion: 1, events: batch })], { type: "application/json" }));
    if (sent) {
      this.queue.splice(0, batch.length);
      writeBuffer(this.queue);
    }
  }

  snapshot(): readonly TelemetryEnvelope[] { return Object.freeze([...this.queue]); }
}

export const telemetrySessionId = makeSessionId();
export const browserTelemetry = new BrowserTelemetrySink();
let latestChronicle: ChronicleSaveV2 | undefined;

export function observeChronicle(previous: ChronicleSaveV2 | null | undefined, current: ChronicleSaveV2): void {
  latestChronicle = current;
  emitAll(browserTelemetry, observeChronicleTransition({ sessionId: telemetrySessionId, previous, current }));
}

export function reportTelemetry(name: string, data: Record<string, unknown> = {}, level: "debug" | "info" | "warn" | "error" = "info"): void {
  browserTelemetry.emit(createTelemetryEvent({ sessionId: telemetrySessionId, chronicle: latestChronicle, kind: "health", name, level, data }));
}

export function reportError(error: unknown, source: string, fatal = false): void {
  browserTelemetry.emit(createErrorTelemetry({ sessionId: telemetrySessionId, chronicle: latestChronicle, error, source, fatal }));
}

export function reportDuration(metric: string, startedAt: number, threshold?: number): void {
  browserTelemetry.emit(createPerformanceTelemetry({
    sessionId: telemetrySessionId,
    chronicle: latestChronicle,
    metric,
    value: Math.max(0, performance.now() - startedAt),
    unit: "ms",
    threshold,
  }));
}

export function installGlobalObservability(): () => void {
  reportTelemetry("session_started", {
    userAgentFamily: typeof navigator !== "undefined" ? navigator.userAgent.split(" ").slice(0, 3).join(" ") : "unknown",
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
  });

  const onError = (event: ErrorEvent) => reportError(event.error ?? event.message, "window.error", true);
  const onUnhandled = (event: PromiseRejectionEvent) => reportError(event.reason, "window.unhandledrejection");
  const onOnline = () => { reportTelemetry("network_online"); void browserTelemetry.flush(); };
  const onOffline = () => reportTelemetry("network_offline", {}, "warn");
  const onVisibility = () => {
    reportTelemetry("visibility_changed", { state: document.visibilityState });
    if (document.visibilityState === "hidden") browserTelemetry.flushBeacon();
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandled);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisibility);

  let performanceObserver: PerformanceObserver | undefined;
  if (typeof PerformanceObserver !== "undefined") {
    try {
      performanceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === "longtask") {
            browserTelemetry.emit(createPerformanceTelemetry({ sessionId: telemetrySessionId, chronicle: latestChronicle, metric: "browser_long_task", value: entry.duration, unit: "ms", threshold: 100 }));
          }
        }
      });
      performanceObserver.observe({ entryTypes: ["longtask"] });
    } catch { performanceObserver = undefined; }
  }

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandled);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisibility);
    performanceObserver?.disconnect();
    browserTelemetry.flushBeacon();
  };
}
