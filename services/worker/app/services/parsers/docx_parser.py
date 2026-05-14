from __future__ import annotations

from io import BytesIO

from docx import Document as DocxDocument
from docx.document import Document as DocxFile
from docx.table import Table
from docx.text.paragraph import Paragraph

from app.services.errors import IngestionError, IngestionErrorCode
from app.services.models import ParsedBlock, ParsedDocument
from app.services.parsers.base import classify_line, ensure_blocks, looks_like_heading


class DocxParser:
    def parse(self, data: bytes, source_title: str) -> ParsedDocument:
        try:
            document = DocxDocument(BytesIO(data))
            blocks: list[ParsedBlock] = []
            paragraph_count = 0
            table_count = 0

            for item in self._iter_block_items(document):
                if isinstance(item, Paragraph):
                    block = self._parse_paragraph(item)
                    if block is None:
                        continue
                    paragraph_count += 1
                    blocks.append(block)
                    continue

                for row_block in self._parse_table(item):
                    table_count += 1
                    blocks.append(row_block)
        except Exception as exc:
            raise IngestionError(
                code=IngestionErrorCode.FILE_PARSE_FAILED,
                message="Failed to extract text from DOCX",
                retryable=False,
            ) from exc

        return ensure_blocks(
            ParsedDocument(
                file_type="docx",
                source_title=source_title,
                blocks=blocks,
                metadata={
                    "parser": "python-docx",
                    "page_mapping_available": False,
                    "paragraph_count": paragraph_count,
                    "table_row_count": table_count,
                    "extraction_warnings": [],
                },
            )
        )

    def _iter_block_items(self, document: DocxFile):
        for child in document.element.body.iterchildren():
            if child.tag.endswith("}p"):
                yield Paragraph(child, document)
            elif child.tag.endswith("}tbl"):
                yield Table(child, document)

    def _parse_paragraph(self, paragraph: Paragraph) -> ParsedBlock | None:
        text = paragraph.text.strip()
        if not text:
            return None

        style_name = (getattr(paragraph.style, "name", "") or "").strip()
        style_lower = style_name.lower()
        metadata: dict[str, object] = {"parser": "python-docx"}

        if style_lower.startswith("heading"):
            heading_level = self._heading_level_from_style(style_name)
            metadata["heading_level"] = heading_level
            metadata["heading_source"] = "docx_style"
            return ParsedBlock(text=text, kind="heading", metadata=metadata)

        if self._is_list_paragraph(paragraph, style_lower):
            list_marker = "-"
            metadata["list_marker"] = list_marker
            metadata["structure_source"] = "docx_list"
            return ParsedBlock(text=f"{list_marker} {text}", kind="list_item", metadata=metadata)

        structured = classify_line(text)
        if structured is not None and structured.kind != "heading":
            return ParsedBlock(text=structured.text, kind=structured.kind, metadata=metadata | structured.metadata)

        if looks_like_heading(text):
            metadata["heading_level"] = 1
            metadata["heading_source"] = "heuristic"
            return ParsedBlock(text=text.rstrip(":"), kind="heading", metadata=metadata)

        return ParsedBlock(text=text, kind="paragraph", metadata=metadata)

    def _parse_table(self, table: Table) -> list[ParsedBlock]:
        rows = [[cell.text.strip() for cell in row.cells] for row in table.rows]
        rows = [[cell for cell in row if cell] for row in rows if any(cell.strip() for cell in row)]
        if not rows:
            return []

        headers = rows[0] if len(rows) > 1 and len(rows[0]) == len(rows[1]) else []
        data_rows = rows[1:] if headers else rows
        blocks: list[ParsedBlock] = []
        for row in data_rows:
            if headers and len(row) == len(headers):
                rendered = " | ".join(f"{header}: {value}" for header, value in zip(headers, row) if value)
            else:
                rendered = " | ".join(row)
            if not rendered:
                continue
            blocks.append(
                ParsedBlock(
                    text=rendered,
                    kind="table_row",
                    metadata={
                        "parser": "python-docx",
                        "column_count": len(row),
                        "structure_source": "docx_table",
                        "headers": headers,
                    },
                )
            )
        return blocks

    def _heading_level_from_style(self, style_name: str) -> int:
        for token in style_name.split():
            if token.isdigit():
                return min(int(token), 6)
        return 1

    def _is_list_paragraph(self, paragraph: Paragraph, style_lower: str) -> bool:
        if "list" in style_lower:
            return True
        p_pr = getattr(paragraph._p, "pPr", None)
        return bool(p_pr is not None and getattr(p_pr, "numPr", None) is not None)
