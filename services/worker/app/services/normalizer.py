import re
import unicodedata
from collections import Counter

from app.services.errors import IngestionError, IngestionErrorCode
from app.services.models import ParsedBlock, ParsedDocument


class TextNormalizer:
    def normalize_document(self, document: ParsedDocument) -> ParsedDocument:
        raw_joined = "\n\n".join(block.text for block in document.blocks)
        raw_alnum_count = sum(1 for ch in raw_joined if ch.isalnum())
        raw_nonspace_count = sum(1 for ch in raw_joined if not ch.isspace())

        try:
            normalized_blocks: list[ParsedBlock] = []
            counters: Counter[str] = Counter()
            for block in document.blocks:
                normalized_text, flags = self._normalize_block(block.text, block.kind)
                counters.update(flags)
                if not normalized_text:
                    continue

                metadata = dict(block.metadata)
                if flags:
                    metadata["normalization_flags"] = sorted(set(flags))
                normalized_blocks.append(
                    ParsedBlock(
                        text=normalized_text,
                        kind=block.kind,
                        page_number=block.page_number,
                        metadata=metadata,
                    )
                )
        except IngestionError:
            raise
        except Exception as exc:
            raise IngestionError(
                code=IngestionErrorCode.NORMALIZATION_FAILED,
                message="Failed to normalize extracted text",
                retryable=False,
            ) from exc

        joined = "\n\n".join(block.text for block in normalized_blocks)
        alnum_count = sum(1 for ch in joined if ch.isalnum())
        nonspace_count = sum(1 for ch in joined if not ch.isspace())
        if raw_nonspace_count >= 80 and (raw_alnum_count / max(raw_nonspace_count, 1)) < 0.1:
            raise IngestionError(
                code=IngestionErrorCode.LOW_QUALITY_EXTRACTION,
                message="Extracted text quality was too poor to index safely",
                retryable=False,
            )
        if alnum_count < 20:
            raise IngestionError(
                code=IngestionErrorCode.EMPTY_DOCUMENT,
                message="Document text was empty after normalization",
                retryable=False,
            )
        if nonspace_count >= 80 and (alnum_count / max(nonspace_count, 1)) < 0.1:
            raise IngestionError(
                code=IngestionErrorCode.LOW_QUALITY_EXTRACTION,
                message="Extracted text quality was too poor to index safely",
                retryable=False,
            )

        metadata = dict(document.metadata)
        metadata["normalization"] = {
            "version": "text_normalization_v2",
            "blocks_in": len(document.blocks),
            "blocks_out": len(normalized_blocks),
            "dehyphenated_breaks": counters["dehyphenated_breaks"],
            "soft_wrap_joins": counters["soft_wrap_joins"],
            "blank_runs_collapsed": counters["blank_runs_collapsed"],
            "noise_lines_removed": counters["noise_lines_removed"],
        }

        return ParsedDocument(
            file_type=document.file_type,
            source_title=document.source_title,
            blocks=normalized_blocks,
            language=document.language,
            metadata=metadata,
        )

    def build_search_text(self, text: str) -> str:
        return re.sub(r"\s+", " ", text).strip().lower()

    def _normalize_block(self, text: str, kind: str) -> tuple[str, list[str]]:
        flags: list[str] = []
        text = unicodedata.normalize("NFKC", text or "")
        text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
        text = "".join(ch for ch in text if ch in {"\n", "\t"} or unicodedata.category(ch)[0] != "C")
        text = re.sub(r"[ \t]+\n", "\n", text)
        text, dehyphenated = re.subn(r"(?<=\w)-\n(?=\w)", "", text)
        if dehyphenated:
            flags.append("dehyphenated_breaks")

        lines = [self._normalize_line(line, kind) for line in text.split("\n")]
        cleaned_lines: list[str] = []
        for line in lines:
            if not line:
                cleaned_lines.append("")
                continue
            if self._is_obvious_noise_line(line):
                flags.append("noise_lines_removed")
                continue
            cleaned_lines.append(line)

        normalized = self._render_lines(cleaned_lines, kind, flags)
        normalized = re.sub(r"\n{3,}", "\n\n", normalized)
        normalized = re.sub(r"[ \t]{2,}", " ", normalized)
        return normalized.strip(), flags

    def _normalize_line(self, line: str, kind: str) -> str:
        line = line.expandtabs(4)
        if kind == "table_row":
            cells = [cell.strip() for cell in re.split(r"\s*\|\s*", line) if cell.strip()]
            return " | ".join(cells)
        line = re.sub(r"[ \t]{2,}", " ", line)
        return line.strip()

    def _render_lines(self, lines: list[str], kind: str, flags: list[str]) -> str:
        if kind in {"heading", "qa_pair", "table_row"}:
            return "\n".join(line for line in lines if line)

        if kind == "list_item":
            nonempty = [line for line in lines if line]
            if not nonempty:
                return ""
            if len(nonempty) > 1:
                flags.append("soft_wrap_joins")
            return " ".join(nonempty)

        segments: list[str] = []
        current: list[str] = []
        blank_runs_collapsed = False
        soft_wrap_joins = 0
        for line in lines:
            if not line:
                if current:
                    segments.append(" ".join(current))
                    current = []
                if segments and segments[-1]:
                    segments.append("")
                else:
                    blank_runs_collapsed = True
                continue
            current.append(line)
            if len(current) > 1:
                soft_wrap_joins += 1
        if current:
            segments.append(" ".join(current))

        while segments and segments[-1] == "":
            segments.pop()
        if soft_wrap_joins:
            flags.append("soft_wrap_joins")
        if blank_runs_collapsed:
            flags.append("blank_runs_collapsed")
        return "\n\n".join(segment for segment in segments if segment is not None)

    def _is_obvious_noise_line(self, line: str) -> bool:
        stripped = line.strip()
        if not stripped:
            return False
        if any(ch.isalnum() for ch in stripped):
            return False
        symbols_only = re.sub(r"\s+", "", stripped)
        return len(symbols_only) >= 4
