import json
import logging
from datetime import datetime, timezone
from typing import Any

REDACTED = "[REDACTED]"
SENSITIVE_KEYS = (
    "authorization",
    "password",
    "secret",
    "token",
    "api_key",
    "apikey",
    "s3_key",
    "object_key",
    "prompt",
    "input",
)


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            _to_snake_case(key): REDACTED if any(marker in key.lower() for marker in SENSITIVE_KEYS) else _redact(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return value


def _to_snake_case(value: str) -> str:
    result = []
    for index, char in enumerate(value):
        if char.isupper() and index > 0 and value[index - 1] not in {"_", "-", " "}:
            result.append("_")
        if char in {"-", " "}:
            result.append("_")
        else:
            result.append(char.lower())
    return "".join(result)


class JsonFormatter(logging.Formatter):
    def __init__(self) -> None:
        super().__init__()
        self._reserved = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__.keys())

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        for key, value in record.__dict__.items():
            if key in self._reserved or value is None:
                continue
            normalized_key = _to_snake_case(key)
            payload[normalized_key] = (
                REDACTED if any(marker in key.lower() for marker in SENSITIVE_KEYS) else _redact(value)
            )

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, ensure_ascii=True, default=str)


def configure_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    root.handlers.clear()
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    root.setLevel(level.upper())


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
