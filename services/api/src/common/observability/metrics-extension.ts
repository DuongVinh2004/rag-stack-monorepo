/**
 * Extension points for exporting in-process metrics to Prometheus, OpenTelemetry,
 * or another backend. {@link MetricsService} remains the single emission surface.
 *
 * Suggested names (see call sites): http_requests_total, chat_requests_total,
 * retrieval_stage_duration_ms, retrieval_zero_hits_total, openai_requests_total,
 * ingest_job_retries_total.
 *
 * Distributed tracing: {@link TracingService} is a no-op span holder today; replace
 * with OTel when wiring an exporter.
 */
export type MetricsSnapshot = {
  counters: Record<string, number>;
  histograms: Record<string, unknown>;
  capturedAt: string;
};

export type MetricExportHook = (snapshot: MetricsSnapshot) => void;

let exportHook: MetricExportHook | undefined;

export function registerMetricsExportHook(hook: MetricExportHook | undefined) {
  exportHook = hook;
}

export function emitMetricsExportIfRegistered(snapshot: MetricsSnapshot) {
  exportHook?.(snapshot);
}
