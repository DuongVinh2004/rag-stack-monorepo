from __future__ import annotations

import math
import re
from io import BytesIO

from pypdf import PdfReader

from app.services.errors import IngestionError, IngestionErrorCode
from app.services.models import ParsedBlock, ParsedDocument
from app.services.parsers.base import build_blocks_from_lines, ensure_blocks, normalize_lines


class PdfParser:
    def parse(self, data: bytes, source_title: str) -> ParsedDocument:
        try:
            reader = PdfReader(BytesIO(data))
            if reader.is_encrypted:
                reader.decrypt("")

            blocks: list[ParsedBlock] = []
            warnings: list[str] = []
            page_lines = [self._extract_page_lines(page) for page in reader.pages]
            repeated_margin_keys = self._detect_repeated_margin_keys(page_lines)
            removed_margin_lines = 0

            for page_index, lines in enumerate(page_lines, start=1):
                trimmed_lines, removed_count = self._strip_repeated_margin_lines(lines, repeated_margin_keys)
                removed_margin_lines += removed_count
                blocks.extend(
                    build_blocks_from_lines(
                        trimmed_lines,
                        page_number=page_index,
                        base_metadata={"parser": "pypdf"},
                    )
                )

            nonempty_pages = sum(1 for lines in page_lines if any(line.strip() for line in lines))
            extracted_chars = sum(len(" ".join(lines)) for lines in page_lines)
            if nonempty_pages < len(page_lines):
                warnings.append("some_pages_empty_after_text_extraction")
            if extracted_chars and extracted_chars / max(len(page_lines), 1) < 80:
                warnings.append("low_text_density_pdf")
            if removed_margin_lines:
                warnings.append("repeated_page_margins_removed")
        except Exception as exc:
            raise IngestionError(
                code=IngestionErrorCode.FILE_PARSE_FAILED,
                message="Failed to extract text from PDF",
                retryable=False,
            ) from exc

        return ensure_blocks(
            ParsedDocument(
                file_type="pdf",
                source_title=source_title,
                blocks=blocks,
                metadata={
                    "parser": "pypdf",
                    "page_count": len(reader.pages) if "reader" in locals() else 0,
                    "page_mapping_available": True,
                    "extraction_warnings": warnings,
                    "extraction_quality": {
                        "nonempty_pages": nonempty_pages,
                        "page_count": len(page_lines),
                        "removed_margin_lines": removed_margin_lines,
                        "extracted_char_count": extracted_chars,
                    },
                },
            )
        )

    def _extract_page_lines(self, page) -> list[str]:
        text = page.extract_text() or ""
        return [line.rstrip() for line in normalize_lines(text)]

    def _detect_repeated_margin_keys(self, pages: list[list[str]]) -> set[str]:
        if len(pages) < 2:
            return set()

        threshold = max(2, math.ceil(len(pages) * 0.7))
        counts: dict[str, int] = {}
        for lines in pages:
            nonempty = [line.strip() for line in lines if line.strip()]
            if not nonempty:
                continue
            candidates = nonempty[:2] + nonempty[-2:]
            seen_for_page: set[str] = set()
            for candidate in candidates:
                key = self._normalize_margin_candidate(candidate)
                if key and key not in seen_for_page:
                    counts[key] = counts.get(key, 0) + 1
                    seen_for_page.add(key)
        return {key for key, count in counts.items() if count >= threshold}

    def _strip_repeated_margin_lines(self, lines: list[str], repeated_keys: set[str]) -> tuple[list[str], int]:
        if not repeated_keys:
            return lines, 0

        trimmed = list(lines)
        removed = 0
        while trimmed and not trimmed[0].strip():
            trimmed.pop(0)
        while trimmed and not trimmed[-1].strip():
            trimmed.pop()
        while trimmed and trimmed[0].strip() and self._normalize_margin_candidate(trimmed[0]) in repeated_keys:
            trimmed.pop(0)
            removed += 1
        while trimmed and trimmed[-1].strip() and self._normalize_margin_candidate(trimmed[-1]) in repeated_keys:
            trimmed.pop()
            removed += 1
        return trimmed, removed

    def _normalize_margin_candidate(self, line: str) -> str:
        candidate = re.sub(r"\d+", "#", line.strip().lower())
        candidate = re.sub(r"\s+", " ", candidate)
        if len(candidate) < 4 or len(candidate) > 120:
            return ""
        if candidate.count("#") == len(candidate.replace(" ", "")):
            return ""
        return candidate
