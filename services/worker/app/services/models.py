from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


BlockKind = Literal["heading", "paragraph", "list_item", "table_row", "qa_pair"]


@dataclass(slots=True)
class IngestJobPayload:
    ingest_job_id: str
    document_id: str
    document_version_id: str
    kb_id: str
    bucket: str
    s3_key: str
    mime_type: str
    source_title: str
    correlation_id: str | None
    pipeline_version: str
    ingest_version: int

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "IngestJobPayload":
        return cls(
            ingest_job_id=raw["ingestJobId"],
            document_id=raw["documentId"],
            document_version_id=raw["documentVersionId"],
            kb_id=raw["kbId"],
            bucket=raw["bucket"],
            s3_key=raw["s3Key"],
            mime_type=raw["mimeType"],
            source_title=raw["sourceTitle"],
            correlation_id=raw.get("correlationId"),
            pipeline_version=raw["pipelineVersion"],
            ingest_version=int(raw["ingestVersion"]),
        )


@dataclass(slots=True)
class ParsedBlock:
    text: str
    kind: BlockKind = "paragraph"
    page_number: int | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class ParsedDocument:
    file_type: str
    source_title: str
    blocks: list[ParsedBlock]
    language: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class ChunkRecord:
    chunk_no: int
    content: str
    search_text: str
    token_count: int
    section_title: str | None
    page_number: int | None
    source_title: str
    language: str | None
    chunking_strategy: str
    chunking_version: str
    checksum: str
    metadata_json: dict[str, Any]
    embedding: list[float] | None = None
    embedding_model: str | None = None
    embedding_dim: int | None = None


@dataclass(slots=True)
class JobContext:
    ingest_job_id: str
    document_id: str
    document_version_id: str
    kb_id: str
    source_title: str
    mime_type: str
    s3_key: str
    bucket: str
    correlation_id: str | None
    pipeline_version: str
    ingest_version: int
    attempt_no: int
    max_attempts: int
