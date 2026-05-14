from __future__ import annotations

from charset_normalizer import from_bytes

from app.services.errors import IngestionError, IngestionErrorCode
from app.services.models import ParsedDocument
from app.services.parsers.base import build_blocks_from_lines, ensure_blocks, normalize_lines


class TxtParser:
    def parse(self, data: bytes, source_title: str) -> ParsedDocument:
        try:
            text, encoding = self._decode(data)
            blocks = build_blocks_from_lines(
                normalize_lines(text),
                base_metadata={"parser": "text", "encoding": encoding},
            )
        except IngestionError:
            raise
        except Exception as exc:
            raise IngestionError(
                code=IngestionErrorCode.FILE_PARSE_FAILED,
                message="Failed to parse text file",
                retryable=False,
            ) from exc

        return ensure_blocks(
            ParsedDocument(
                file_type="txt",
                source_title=source_title,
                blocks=blocks,
                metadata={
                    "parser": "text",
                    "page_mapping_available": False,
                    "encoding": encoding,
                    "paragraph_count": len(blocks),
                    "extraction_warnings": [],
                },
            )
        )

    def _decode(self, data: bytes) -> tuple[str, str]:
        if not data:
            return "", "utf-8"
        match = from_bytes(data).best()
        if match is not None:
            return str(match), match.encoding or "unknown"
        for encoding in ("utf-8-sig", "utf-8", "latin-1"):
            try:
                return data.decode(encoding), encoding
            except UnicodeDecodeError:
                continue
        raise IngestionError(
            code=IngestionErrorCode.FILE_PARSE_FAILED,
            message="Text file encoding could not be decoded",
            retryable=False,
        )
