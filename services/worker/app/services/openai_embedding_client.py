from __future__ import annotations

import asyncio
from dataclasses import dataclass
from time import perf_counter

from openai import (
    APIConnectionError,
    APITimeoutError,
    AsyncOpenAI,
    AuthenticationError,
    BadRequestError,
    InternalServerError,
    PermissionDeniedError,
    RateLimitError,
)

from app.core.logging import get_logger
from app.core.settings import Settings
from app.services.errors import IngestionError, IngestionErrorCode


@dataclass(slots=True)
class EmbeddingBatchUsage:
    input_tokens: int = 0
    total_tokens: int = 0


@dataclass(slots=True)
class EmbeddingBatchResult:
    embeddings: list[list[float]]
    usage: EmbeddingBatchUsage
    latency_ms: float
    attempts: int


class OpenAiEmbeddingClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._logger = get_logger("worker.openai.embedding_client")
        self._client = (
            AsyncOpenAI(
                api_key=settings.openai_api_key,
                max_retries=0,
                timeout=settings.openai_request_timeout_ms / 1000,
            )
            if settings.openai_api_key and settings.openai_embeddings_enabled
            else None
        )

    @property
    def enabled(self) -> bool:
        return self._client is not None

    @property
    def model_name(self) -> str | None:
        return self._settings.openai_embedding_model if self.enabled else None

    async def embed_texts(
        self,
        texts: list[str],
        request_context: dict | None = None,
    ) -> EmbeddingBatchResult:
        if not self.enabled or self._client is None:
            raise IngestionError(
                code=IngestionErrorCode.OPENAI_EMBEDDING_FAILED,
                message="OpenAI embeddings are unavailable because the feature is disabled or OPENAI_API_KEY is missing",
                retryable=False,
            )

        total_started_at = perf_counter()
        max_attempts = self._settings.openai_max_retries + 1

        for attempt in range(1, max_attempts + 1):
            try:
                response = await self._client.embeddings.create(
                    model=self._settings.openai_embedding_model,
                    input=texts,
                )
                embeddings = [list(item.embedding or []) for item in response.data]
                if len(embeddings) != len(texts):
                    raise IngestionError(
                        code=IngestionErrorCode.OPENAI_EMBEDDING_FAILED,
                        message="OpenAI returned an incomplete embeddings batch",
                        retryable=False,
                        details={
                            "attempts": attempt,
                            "expected_items": len(texts),
                            "returned_items": len(embeddings),
                        },
                    )
                if any(not embedding for embedding in embeddings):
                    raise IngestionError(
                        code=IngestionErrorCode.OPENAI_RESPONSE_EMPTY,
                        message="OpenAI returned an empty embedding vector",
                        retryable=False,
                        details={"attempts": attempt},
                    )

                return EmbeddingBatchResult(
                    embeddings=embeddings,
                    usage=EmbeddingBatchUsage(
                        input_tokens=int(getattr(getattr(response, "usage", None), "prompt_tokens", 0) or 0),
                        total_tokens=int(getattr(getattr(response, "usage", None), "total_tokens", 0) or 0),
                    ),
                    latency_ms=round((perf_counter() - total_started_at) * 1000, 2),
                    attempts=attempt,
                )
            except IngestionError as exc:
                if not exc.retryable or attempt >= max_attempts:
                    self._attach_attempts(exc, attempt)
                    raise
                await self._sleep_before_retry(exc, attempt, request_context)
            except (AuthenticationError, PermissionDeniedError) as exc:
                mapped = self._map_provider_error(
                    exc,
                    code=IngestionErrorCode.OPENAI_AUTH_ERROR,
                    message="OpenAI authentication failed for embeddings",
                    retryable=False,
                    attempt=attempt,
                )
                raise mapped from exc
            except RateLimitError as exc:
                mapped = self._map_provider_error(
                    exc,
                    code=IngestionErrorCode.OPENAI_RATE_LIMIT,
                    message="OpenAI rate limit exceeded during embeddings",
                    retryable=True,
                    attempt=attempt,
                )
                if attempt >= max_attempts:
                    raise mapped from exc
                await self._sleep_before_retry(mapped, attempt, request_context)
            except APITimeoutError as exc:
                mapped = self._map_provider_error(
                    exc,
                    code=IngestionErrorCode.OPENAI_TIMEOUT,
                    message="OpenAI embeddings request timed out",
                    retryable=True,
                    attempt=attempt,
                )
                if attempt >= max_attempts:
                    raise mapped from exc
                await self._sleep_before_retry(mapped, attempt, request_context)
            except (APIConnectionError, InternalServerError) as exc:
                mapped = self._map_provider_error(
                    exc,
                    code=IngestionErrorCode.OPENAI_TRANSIENT_ERROR,
                    message="OpenAI embeddings request failed with a transient error",
                    retryable=True,
                    attempt=attempt,
                )
                if attempt >= max_attempts:
                    raise mapped from exc
                await self._sleep_before_retry(mapped, attempt, request_context)
            except BadRequestError as exc:
                mapped = self._map_provider_error(
                    exc,
                    code=IngestionErrorCode.OPENAI_INVALID_REQUEST,
                    message="OpenAI rejected the embeddings request",
                    retryable=False,
                    attempt=attempt,
                )
                raise mapped from exc
            except Exception as exc:
                mapped = IngestionError(
                    code=IngestionErrorCode.OPENAI_EMBEDDING_FAILED,
                    message="Embedding generation failed unexpectedly",
                    retryable=True,
                    details={
                        "attempts": attempt,
                        "embedding_model": self._settings.openai_embedding_model,
                        "provider_error": exc.__class__.__name__,
                    },
                )
                if attempt >= max_attempts:
                    raise mapped from exc
                await self._sleep_before_retry(mapped, attempt, request_context)

        raise IngestionError(
            code=IngestionErrorCode.OPENAI_EMBEDDING_FAILED,
            message="Embedding generation failed unexpectedly",
            retryable=True,
            details={"embedding_model": self._settings.openai_embedding_model},
        )

    async def _sleep_before_retry(
        self,
        error: IngestionError,
        attempt: int,
        request_context: dict | None,
    ) -> None:
        delay_ms = min(
            2000,
            self._settings.openai_retry_base_delay_ms * 2 ** max(0, attempt - 1),
        )
        self._logger.warning(
            "Retrying OpenAI embeddings request",
            extra=(request_context or {})
            | {
                "event": "openai_request_retry_scheduled",
                "attempt": attempt,
                "error_code": error.code.value,
                "embedding_model": self._settings.openai_embedding_model,
                "next_delay_ms": delay_ms,
            },
        )
        await asyncio.sleep(delay_ms / 1000)

    def _map_provider_error(
        self,
        error: Exception,
        *,
        code: IngestionErrorCode,
        message: str,
        retryable: bool,
        attempt: int,
    ) -> IngestionError:
        provider_status = getattr(error, "status_code", None) or getattr(error, "status", None)
        return IngestionError(
            code=code,
            message=message,
            retryable=retryable,
            details={
                "attempts": attempt,
                "embedding_model": self._settings.openai_embedding_model,
                "provider_error": error.__class__.__name__,
                "provider_status": int(provider_status) if provider_status is not None else None,
            },
        )

    def _attach_attempts(self, error: IngestionError, attempt: int) -> None:
        details = dict(error.details or {})
        details.setdefault("attempts", attempt)
        details.setdefault("embedding_model", self._settings.openai_embedding_model)
        error.details = details
