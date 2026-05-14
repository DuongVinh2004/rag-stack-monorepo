from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


@dataclass(slots=True)
class MetricEvent:
    kind: str
    name: str
    value: float
    tags: dict[str, str | int | bool | None]


MetricHook = Callable[[MetricEvent], None]

_metric_hook: MetricHook | None = None


def register_metric_hook(hook: MetricHook | None) -> None:
    global _metric_hook
    _metric_hook = hook


def emit_counter(name: str, value: float = 1, tags: dict[str, str | int | bool | None] | None = None) -> None:
    if _metric_hook is None:
        return
    _metric_hook(
        MetricEvent(
            kind="counter",
            name=name,
            value=value,
            tags=tags or {},
        )
    )


def emit_duration(name: str, duration_ms: float, tags: dict[str, str | int | bool | None] | None = None) -> None:
    if _metric_hook is None:
        return
    _metric_hook(
        MetricEvent(
            kind="duration",
            name=name,
            value=duration_ms,
            tags=tags or {},
        )
    )
