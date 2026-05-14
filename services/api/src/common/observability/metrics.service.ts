import { Injectable } from '@nestjs/common';

type MetricTags = Record<string, string | number | boolean | null | undefined>;

type HistogramStats = {
  count: number;
  avg: number;
  p50: number;
  p95: number;
  max: number;
};

@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly histograms = new Map<string, number[]>();
  private readonly maxSamples = 500;

  increment(name: string, value = 1, tags?: MetricTags) {
    const key = this.buildKey(name, tags);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  recordDuration(name: string, durationMs: number, tags?: MetricTags) {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return;
    }

    const key = this.buildKey(name, tags);
    const current = this.histograms.get(key) ?? [];
    current.push(durationMs);
    if (current.length > this.maxSamples) {
      current.splice(0, current.length - this.maxSamples);
    }
    this.histograms.set(key, current);
  }

  snapshot() {
    const counters: Record<string, number> = {};
    this.counters.forEach((value, key) => {
      counters[key] = value;
    });

    const histograms: Record<string, HistogramStats> = {};
    this.histograms.forEach((values, key) => {
      histograms[key] = this.toHistogramStats(values);
    });

    return {
      counters,
      histograms,
      capturedAt: new Date().toISOString(),
    };
  }

  private buildKey(name: string, tags?: MetricTags) {
    if (!tags || !Object.keys(tags).length) {
      return name;
    }

    const suffix = Object.entries(tags)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(',');

    return `${name}{${suffix}}`;
  }

  private toHistogramStats(values: number[]): HistogramStats {
    if (!values.length) {
      return { count: 0, avg: 0, p50: 0, p95: 0, max: 0 };
    }

    const sorted = [...values].sort((left, right) => left - right);
    const sum = sorted.reduce((total, value) => total + value, 0);

    return {
      count: sorted.length,
      avg: Number((sum / sorted.length).toFixed(2)),
      p50: this.percentile(sorted, 0.5),
      p95: this.percentile(sorted, 0.95),
      max: Number(sorted[sorted.length - 1].toFixed(2)),
    };
  }

  private percentile(sorted: number[], quantile: number) {
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
    return Number(sorted[index].toFixed(2));
  }
}
