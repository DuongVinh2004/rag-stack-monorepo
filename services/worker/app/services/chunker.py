from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from app.core.settings import Settings
from app.services.errors import IngestionError, IngestionErrorCode
from app.services.models import ChunkRecord, ParsedBlock, ParsedDocument
from app.services.normalizer import TextNormalizer
from app.services.token_counter import TokenCounter


@dataclass(slots=True)
class _Section:
    title: str | None
    path: list[str]
    heading_level: int | None
    blocks: list[tuple[int, ParsedBlock]]


@dataclass(slots=True)
class _TextUnit:
    text: str
    token_count: int
    page_numbers: list[int]
    block_kinds: list[str]
    block_indexes: list[int]
    section_title: str | None
    section_path: list[str]
    heading_level: int | None


class Chunker:
    def __init__(self, settings: Settings, token_counter: TokenCounter, normalizer: TextNormalizer) -> None:
        self._settings = settings
        self._token_counter = token_counter
        self._normalizer = normalizer

    def chunk_document(self, document: ParsedDocument) -> list[ChunkRecord]:
        try:
            chunk_no = 1
            chunks: list[ChunkRecord] = []
            sections = self._build_sections(document.blocks)
            for section_group in self._merge_small_sections(sections):
                if len(section_group) == 1:
                    section = section_group[0]
                    units = self._build_units(section)
                    for unit_group in self._group_units(
                        units,
                        sticky_heading=section.title,
                        heading_level=section.heading_level,
                    ):
                        chunks.append(self._make_chunk(document, unit_group, chunk_no))
                        chunk_no += 1
                    continue

                group_units = self._build_group_units(section_group)
                for unit_group in self._group_units(group_units):
                    chunks.append(self._make_chunk(document, unit_group, chunk_no))
                    chunk_no += 1
        except IngestionError:
            raise
        except Exception as exc:
            raise IngestionError(
                code=IngestionErrorCode.CHUNKING_FAILED,
                message="Failed to split document into chunks",
                retryable=False,
            ) from exc

        if not chunks:
            raise IngestionError(
                code=IngestionErrorCode.CHUNKING_FAILED,
                message="Chunking produced no chunks",
                retryable=False,
            )
        return chunks

    def _build_sections(self, blocks: list[ParsedBlock]) -> list[_Section]:
        sections: list[_Section] = []
        heading_stack: list[str] = []
        current_title: str | None = None
        current_path: list[str] = []
        current_level: int | None = None
        current_blocks: list[tuple[int, ParsedBlock]] = []

        for index, block in enumerate(blocks):
            if block.kind == "heading":
                if current_blocks:
                    sections.append(
                        _Section(
                            title=current_title,
                            path=list(current_path),
                            heading_level=current_level,
                            blocks=current_blocks,
                        )
                    )
                    current_blocks = []

                level = self._heading_level(block)
                while heading_stack and len(heading_stack) >= level:
                    heading_stack.pop()
                heading_stack.append(block.text)
                current_title = block.text
                current_path = list(heading_stack)
                current_level = level
                continue

            current_blocks.append((index, block))

        if current_blocks:
            sections.append(
                _Section(
                    title=current_title,
                    path=list(current_path),
                    heading_level=current_level,
                    blocks=current_blocks,
                )
            )

        if not sections:
            sections.append(_Section(title=None, path=[], heading_level=None, blocks=[]))
        return sections

    def _merge_small_sections(self, sections: list[_Section]) -> list[list[_Section]]:
        if len(sections) <= 1:
            return [[section] for section in sections]

        merged: list[list[_Section]] = []
        index = 0
        minimum_section_tokens = max(20, min(100, self._settings.chunk_target_tokens // 4))
        while index < len(sections):
            current_group = [sections[index]]
            current_tokens = self._section_tokens(sections[index])
            while (
                current_tokens < minimum_section_tokens
                and index + 1 < len(sections)
                and current_tokens + self._section_tokens(sections[index + 1]) <= self._settings.chunk_target_tokens
            ):
                index += 1
                current_group.append(sections[index])
                current_tokens += self._section_tokens(sections[index])

            if (
                len(current_group) == 1
                and current_tokens < minimum_section_tokens
                and merged
                and self._group_tokens(merged[-1]) + current_tokens <= self._settings.chunk_target_tokens
            ):
                merged[-1].append(current_group[0])
            else:
                merged.append(current_group)
            index += 1
        return merged

    def _build_group_units(self, sections: list[_Section]) -> list[_TextUnit]:
        units: list[_TextUnit] = []
        for section in sections:
            if section.title:
                page_numbers = self._section_page_numbers(section)
                units.append(
                    _TextUnit(
                        text=section.title,
                        token_count=self._token_counter.count(section.title),
                        page_numbers=page_numbers,
                        block_kinds=["heading"],
                        block_indexes=[index for index, _ in section.blocks],
                        section_title=section.title,
                        section_path=section.path,
                        heading_level=section.heading_level,
                    )
                )
            units.extend(self._build_units(section))
        return units

    def _build_units(self, section: _Section) -> list[_TextUnit]:
        units: list[_TextUnit] = []
        max_tokens = self._settings.chunk_target_tokens
        if section.title:
            max_tokens = max(1, max_tokens - self._token_counter.count(section.title))
        index = 0
        while index < len(section.blocks):
            block_index, block = section.blocks[index]
            if block.kind == "qa_pair":
                merged_texts = [block.text.strip()]
                page_numbers = self._unique_page_numbers([block.page_number])
                block_indexes = [block_index]
                labels = [str(block.metadata.get("qa_label", ""))]
                index += 1
                while index < len(section.blocks):
                    next_index, next_block = section.blocks[index]
                    if next_block.kind != "qa_pair":
                        break
                    next_label = str(next_block.metadata.get("qa_label", ""))
                    if next_label == "Q" and "A" in labels:
                        break
                    merged_texts.append(next_block.text.strip())
                    page_numbers.extend(self._unique_page_numbers([next_block.page_number]))
                    block_indexes.append(next_index)
                    labels.append(next_label)
                    index += 1

                combined = "\n".join(text for text in merged_texts if text)
                units.extend(
                    self._split_unit_text(
                        combined,
                        max_tokens=max_tokens,
                        page_numbers=self._unique_page_numbers(page_numbers),
                        block_kinds=["qa_pair"],
                        block_indexes=block_indexes,
                        section=section,
                    )
                )
                continue

            units.extend(
                self._split_unit_text(
                    block.text.strip(),
                    max_tokens=max_tokens,
                    page_numbers=self._unique_page_numbers([block.page_number]),
                    block_kinds=[block.kind],
                    block_indexes=[block_index],
                    section=section,
                )
            )
            index += 1
        return units

    def _split_unit_text(
        self,
        text: str,
        *,
        max_tokens: int,
        page_numbers: list[int],
        block_kinds: list[str],
        block_indexes: list[int],
        section: _Section,
    ) -> list[_TextUnit]:
        if not text:
            return []
        if self._token_counter.count(text) <= max_tokens:
            return [
                _TextUnit(
                    text=text,
                    token_count=self._token_counter.count(text),
                    page_numbers=page_numbers,
                    block_kinds=block_kinds,
                    block_indexes=block_indexes,
                    section_title=section.title,
                    section_path=section.path,
                    heading_level=section.heading_level,
                )
            ]

        parts = self._split_large_text(text, block_kinds[0], max_tokens)
        return [
            _TextUnit(
                text=part,
                token_count=self._token_counter.count(part),
                page_numbers=page_numbers,
                block_kinds=block_kinds,
                block_indexes=block_indexes,
                section_title=section.title,
                section_path=section.path,
                heading_level=section.heading_level,
            )
            for part in parts
            if part
        ]

    def _split_large_text(self, text: str, block_kind: str, max_tokens: int) -> list[str]:
        parts: list[str] = []
        if block_kind == "qa_pair":
            parts = [part.strip() for part in re.split(r"\n(?=Q:)", text) if part.strip()]
        elif block_kind in {"list_item", "table_row"}:
            parts = [part.strip() for part in text.split("\n") if part.strip()]
        if len(parts) <= 1:
            parts = [part.strip() for part in re.split(r"\n{2,}", text) if part.strip()]
        if len(parts) <= 1:
            parts = [part.strip() for part in re.split(r"(?<=[.!?])\s+", text) if part.strip()]
        if len(parts) <= 1:
            parts = [part.strip() for part in text.splitlines() if part.strip()]
        if len(parts) <= 1:
            return self._split_by_words(text, max_tokens)
        return self._pack_parts(parts, max_tokens)

    def _pack_parts(self, parts: list[str], max_tokens: int) -> list[str]:
        packed: list[str] = []
        current: list[str] = []
        current_tokens = 0
        for part in parts:
            part_tokens = self._token_counter.count(part)
            if current and current_tokens + part_tokens > max_tokens:
                packed.append(" ".join(current).strip())
                current = [part]
                current_tokens = part_tokens
            else:
                current.append(part)
                current_tokens += part_tokens
        if current:
            packed.append(" ".join(current).strip())
        return packed

    def _split_by_words(self, text: str, max_tokens: int) -> list[str]:
        parts: list[str] = []
        current_words: list[str] = []
        current_tokens = 0
        for word in text.split():
            word_tokens = self._token_counter.count(word)
            if current_words and current_tokens + word_tokens > max_tokens:
                parts.append(" ".join(current_words))
                current_words = [word]
                current_tokens = word_tokens
            else:
                current_words.append(word)
                current_tokens += word_tokens
        if current_words:
            parts.append(" ".join(current_words))
        return parts

    def _group_units(
        self,
        units: list[_TextUnit],
        *,
        sticky_heading: str | None = None,
        heading_level: int | None = None,
    ) -> list[list[_TextUnit]]:
        if not units:
            return []

        prefix_tokens = self._token_counter.count(sticky_heading) if sticky_heading else 0
        chunk_limit = max(1, self._settings.chunk_target_tokens - prefix_tokens)
        grouped: list[list[_TextUnit]] = []
        current: list[_TextUnit] = []
        current_tokens = 0
        index = 0

        while index < len(units):
            unit = units[index]
            if not current:
                current = [unit]
                current_tokens = unit.token_count
                index += 1
                continue

            if current_tokens + unit.token_count <= chunk_limit:
                current.append(unit)
                current_tokens += unit.token_count
                index += 1
                continue

            grouped.append(self._apply_sticky_heading(current, sticky_heading, heading_level))
            overlap_units = self._build_overlap(current)
            overlap_tokens = sum(item.token_count for item in overlap_units)
            while overlap_units and overlap_tokens + unit.token_count > chunk_limit:
                overlap_tokens -= overlap_units[0].token_count
                overlap_units = overlap_units[1:]
            current = overlap_units
            current_tokens = overlap_tokens

        if current:
            grouped.append(self._apply_sticky_heading(current, sticky_heading, heading_level))
        return grouped

    def _apply_sticky_heading(
        self,
        units: list[_TextUnit],
        sticky_heading: str | None,
        heading_level: int | None,
    ) -> list[_TextUnit]:
        if not sticky_heading or (units and units[0].text == sticky_heading):
            return units

        page_numbers = units[0].page_numbers if units else []
        heading_unit = _TextUnit(
            text=sticky_heading,
            token_count=self._token_counter.count(sticky_heading),
            page_numbers=page_numbers,
            block_kinds=["heading"],
            block_indexes=units[0].block_indexes[:1] if units else [],
            section_title=sticky_heading,
            section_path=units[0].section_path if units else [],
            heading_level=heading_level,
        )
        return [heading_unit, *units]

    def _build_overlap(self, units: list[_TextUnit]) -> list[_TextUnit]:
        overlap: list[_TextUnit] = []
        tokens = 0
        for unit in reversed(units):
            if unit.block_kinds == ["heading"]:
                continue
            overlap.insert(0, unit)
            tokens += unit.token_count
            if tokens >= self._settings.chunk_overlap_tokens:
                break
        return overlap

    def _make_chunk(self, document: ParsedDocument, unit_group: list[_TextUnit], chunk_no: int) -> ChunkRecord:
        content = "\n\n".join(unit.text for unit in unit_group if unit.text).strip()
        token_count = self._token_counter.count(content)
        page_numbers = self._unique_page_numbers(
            page_number
            for unit in unit_group
            for page_number in unit.page_numbers
        )
        section_titles = self._unique_strings(unit.section_title for unit in unit_group if unit.section_title)
        section_paths = self._unique_paths(unit.section_path for unit in unit_group if unit.section_path)
        block_indexes = sorted(
            {
                block_index
                for unit in unit_group
                for block_index in unit.block_indexes
            }
        )
        block_kinds = sorted({kind for unit in unit_group for kind in unit.block_kinds})

        metadata_json = {
            "page_numbers": page_numbers,
            "page_start": min(page_numbers) if page_numbers else None,
            "page_end": max(page_numbers) if page_numbers else None,
            "page_mapping_available": document.metadata.get("page_mapping_available", bool(page_numbers)),
            "token_estimator": self._token_counter.encoding_name,
            "unit_count": len(unit_group),
            "block_kinds": block_kinds,
            "source_block_start": block_indexes[0] if block_indexes else None,
            "source_block_end": block_indexes[-1] if block_indexes else None,
            "section_titles": section_titles,
            "section_path": section_paths[0] if len(section_paths) == 1 else None,
            "section_paths": section_paths,
            "parser": document.metadata.get("parser", document.file_type),
            "parser_type": document.file_type,
            "extraction_warnings": document.metadata.get("extraction_warnings", []),
            "normalization": document.metadata.get("normalization", {}),
            "chunking": {
                "strategy": self._settings.chunking_strategy,
                "version": self._settings.chunking_version,
                "target_tokens": self._settings.chunk_target_tokens,
                "overlap_tokens": self._settings.chunk_overlap_tokens,
            },
            "contains_structured_content": any(
                kind in {"list_item", "table_row", "qa_pair"} for kind in block_kinds
            ),
        }

        checksum = hashlib.sha256(
            "|".join(
                [
                    content,
                    ",".join(section_titles),
                    ",".join(str(page) for page in page_numbers),
                    self._settings.chunking_version,
                ]
            ).encode("utf-8")
        ).hexdigest()

        return ChunkRecord(
            chunk_no=chunk_no,
            content=content,
            search_text=self._normalizer.build_search_text(content),
            token_count=token_count,
            section_title=section_titles[0] if section_titles else None,
            page_number=page_numbers[0] if page_numbers else None,
            source_title=document.source_title,
            language=document.language,
            chunking_strategy=self._settings.chunking_strategy,
            chunking_version=self._settings.chunking_version,
            checksum=checksum,
            metadata_json=metadata_json,
        )

    def _section_tokens(self, section: _Section) -> int:
        heading_tokens = self._token_counter.count(section.title) if section.title else 0
        body_tokens = sum(self._token_counter.count(block.text) for _, block in section.blocks)
        return heading_tokens + body_tokens

    def _group_tokens(self, sections: list[_Section]) -> int:
        return sum(self._section_tokens(section) for section in sections)

    def _section_page_numbers(self, section: _Section) -> list[int]:
        return self._unique_page_numbers(block.page_number for _, block in section.blocks)

    def _heading_level(self, block: ParsedBlock) -> int:
        raw_level = block.metadata.get("heading_level")
        if isinstance(raw_level, int) and raw_level > 0:
            return min(raw_level, 6)
        return 1

    def _unique_page_numbers(self, page_numbers) -> list[int]:
        return sorted({page for page in page_numbers if page is not None})

    def _unique_strings(self, values) -> list[str]:
        ordered: list[str] = []
        seen: set[str] = set()
        for value in values:
            if value and value not in seen:
                ordered.append(value)
                seen.add(value)
        return ordered

    def _unique_paths(self, paths) -> list[list[str]]:
        ordered: list[list[str]] = []
        seen: set[tuple[str, ...]] = set()
        for path in paths:
            key = tuple(path)
            if key and key not in seen:
                ordered.append(list(path))
                seen.add(key)
        return ordered
