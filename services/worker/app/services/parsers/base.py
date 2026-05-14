from __future__ import annotations

import re
from dataclasses import dataclass
from io import BytesIO
from typing import Any, Iterable, Protocol
from zipfile import ZipFile

from app.services.errors import IngestionError, IngestionErrorCode
from app.services.models import BlockKind, ParsedBlock, ParsedDocument


class Parser(Protocol):
    def parse(self, data: bytes, source_title: str) -> ParsedDocument:
        ...


_MARKDOWN_HEADING_RE = re.compile(r"^(?P<hashes>#{1,6})\s+(?P<body>.+)$")
_NUMBERED_HEADING_RE = re.compile(
    r"^(?P<prefix>(?:section\s+)?(?:\d+(?:\.\d+){0,4}|[A-Z]|[IVXLC]+)[\).:]?)\s+(?P<body>.+)$",
    re.IGNORECASE,
)
_LIST_ITEM_RE = re.compile(
    r"^(?P<marker>(?:[-*+•◦▪]|(?:\d+|[a-zA-Z])[.)]))\s+(?P<body>.+)$"
)
_QA_RE = re.compile(r"^(?P<label>q(?:uestion)?|a(?:nswer)?)\s*[:.-]\s*(?P<body>.+)$", re.IGNORECASE)
_TABLE_PIPE_RE = re.compile(r"\s*\|\s*")
_TABLE_TAB_RE = re.compile(r"\t+")


@dataclass(slots=True)
class StructuredLine:
    kind: BlockKind
    text: str
    metadata: dict[str, Any]


def looks_like_heading(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return False
    if _MARKDOWN_HEADING_RE.match(stripped):
        return True
    if _QA_RE.match(stripped):
        return False
    if _LIST_ITEM_RE.match(stripped):
        marker_match = _LIST_ITEM_RE.match(stripped)
        if marker_match is not None and _looks_like_heading_body(marker_match.group("body")):
            return True
        return False
    numbered_match = _NUMBERED_HEADING_RE.match(stripped)
    if numbered_match is not None and _looks_like_heading_body(numbered_match.group("body")):
        return True
    if len(stripped) > 140:
        return False
    if stripped.isupper() and len(stripped.split()) <= 10:
        return True
    if stripped.endswith(":") and len(stripped.split()) <= 12:
        return True
    title_case = stripped == stripped.title() and len(stripped.split()) <= 12
    return title_case


def split_paragraphs(text: str) -> list[str]:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", normalized)]
    return [paragraph for paragraph in paragraphs if paragraph]


def parse_docx_xml_signature(data: bytes) -> bool:
    try:
        with ZipFile(BytesIO(data)) as archive:
            names = set(archive.namelist())
            return "word/document.xml" in names and "[Content_Types].xml" in names
    except Exception:
        return False


def normalize_lines(text: str) -> list[str]:
    return text.replace("\r\n", "\n").replace("\r", "\n").split("\n")


def build_blocks_from_lines(
    lines: Iterable[str],
    *,
    page_number: int | None = None,
    base_metadata: dict[str, Any] | None = None,
) -> list[ParsedBlock]:
    blocks: list[ParsedBlock] = []
    paragraph_lines: list[str] = []
    base_metadata = base_metadata or {}
    source_line_no = 0
    paragraph_start_line = 0

    def flush_paragraph() -> None:
        nonlocal paragraph_start_line
        if not paragraph_lines:
            return
        paragraph = "\n".join(paragraph_lines).strip()
        if paragraph:
            blocks.append(
                ParsedBlock(
                    text=paragraph,
                    kind="paragraph",
                    page_number=page_number,
                    metadata=base_metadata
                    | {
                        "source_line_count": len(paragraph_lines),
                        "source_line_start": paragraph_start_line,
                        "source_line_end": source_line_no,
                    },
                )
            )
        paragraph_lines.clear()
        paragraph_start_line = 0

    for raw_line in lines:
        source_line_no += 1
        stripped = raw_line.strip()
        if not stripped:
            flush_paragraph()
            continue

        structured = classify_line(stripped)
        if structured is not None:
            flush_paragraph()
            blocks.append(
                ParsedBlock(
                    text=structured.text,
                    kind=structured.kind,
                    page_number=page_number,
                    metadata=base_metadata
                    | structured.metadata
                    | {
                        "source_line_count": 1,
                        "source_line_start": source_line_no,
                        "source_line_end": source_line_no,
                    },
                )
            )
            continue

        if not paragraph_lines:
            paragraph_start_line = source_line_no
        paragraph_lines.append(stripped)

    flush_paragraph()
    return blocks


def classify_line(text: str) -> StructuredLine | None:
    stripped = text.strip()
    if not stripped:
        return None

    markdown_match = _MARKDOWN_HEADING_RE.match(stripped)
    if markdown_match is not None:
        body = markdown_match.group("body").strip()
        return StructuredLine(
            kind="heading",
            text=body,
            metadata={"heading_level": len(markdown_match.group("hashes")), "heading_source": "markdown"},
        )

    qa_match = _QA_RE.match(stripped)
    if qa_match is not None:
        label = qa_match.group("label")[0].upper()
        body = qa_match.group("body").strip()
        return StructuredLine(
            kind="qa_pair",
            text=f"{label}: {body}",
            metadata={"qa_label": label, "structure_source": "faq_marker"},
        )

    numbered_match = _NUMBERED_HEADING_RE.match(stripped)
    if numbered_match is not None and _looks_like_heading_body(numbered_match.group("body")):
        prefix = numbered_match.group("prefix").strip()
        level = _infer_numbered_heading_level(prefix)
        return StructuredLine(
            kind="heading",
            text=stripped.rstrip(":"),
            metadata={"heading_level": level, "heading_source": "numbered"},
        )

    list_match = _LIST_ITEM_RE.match(stripped)
    if list_match is not None:
        marker = list_match.group("marker")
        body = list_match.group("body").strip()
        return StructuredLine(
            kind="list_item",
            text=f"{marker} {body}",
            metadata={"list_marker": marker, "structure_source": "list_marker"},
        )

    table_cells = _split_table_cells(stripped)
    if len(table_cells) >= 2:
        return StructuredLine(
            kind="table_row",
            text=" | ".join(table_cells),
            metadata={"column_count": len(table_cells), "structure_source": "table_delimiter"},
        )

    if looks_like_heading(stripped):
        return StructuredLine(
            kind="heading",
            text=stripped.rstrip(":"),
            metadata={"heading_level": 1, "heading_source": "heuristic"},
        )
    return None


def _looks_like_heading_body(text: str) -> bool:
    body = text.strip().rstrip(":")
    if not body or len(body.split()) > 12:
        return False
    if len(body) > 120:
        return False
    if body.endswith((".", "?", "!", ";")):
        return False
    if body.isupper():
        return True
    if body == body.title():
        return True
    return bool(re.match(r"^[A-Z][A-Za-z0-9/&()' -]{2,}$", body))


def _infer_numbered_heading_level(prefix: str) -> int:
    cleaned = prefix.lower().replace("section", "").strip()
    digits = re.findall(r"\d+", cleaned)
    if digits:
        return min(len(digits), 6)
    if "." in cleaned:
        return min(cleaned.count(".") + 1, 6)
    return 1


def _split_table_cells(text: str) -> list[str]:
    if "|" in text:
        cells = [cell.strip() for cell in _TABLE_PIPE_RE.split(text) if cell.strip()]
        return cells if len(cells) >= 2 else []
    if "\t" in text:
        cells = [cell.strip() for cell in _TABLE_TAB_RE.split(text) if cell.strip()]
        return cells if len(cells) >= 2 else []
    if re.search(r"\S\s{3,}\S", text):
        cells = [cell.strip() for cell in re.split(r"\s{3,}", text) if cell.strip()]
        return cells if len(cells) >= 2 else []
    return []


def ensure_blocks(document: ParsedDocument) -> ParsedDocument:
    if not document.blocks:
        raise IngestionError(
            code=IngestionErrorCode.EMPTY_DOCUMENT,
            message="Document parser did not return any text",
            retryable=False,
        )
    return document
