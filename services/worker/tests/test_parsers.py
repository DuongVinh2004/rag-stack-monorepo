from app.services.parsers.docx_parser import DocxParser
from app.services.parsers.pdf_parser import PdfParser
from app.services.parsers.txt_parser import TxtParser
from tests.fixtures import (
    build_docx_bytes,
    build_messy_txt_bytes,
    build_pdf_bytes,
    build_pdf_with_repeated_margins_bytes,
    build_txt_bytes,
)


def test_txt_parser_preserves_heading_list_and_faq_blocks() -> None:
    document = TxtParser().parse(build_txt_bytes(), "guide.txt")

    assert document.file_type == "txt"
    assert document.metadata["encoding"]
    assert document.blocks[0].kind == "heading"
    assert document.blocks[0].text == "Incident Guide"
    assert any(block.kind == "list_item" for block in document.blocks)
    assert any(block.kind == "qa_pair" and block.text.startswith("Q:") for block in document.blocks)


def test_txt_parser_handles_messy_whitespace_without_losing_structure() -> None:
    document = TxtParser().parse(build_messy_txt_bytes(), "faq.txt")

    assert document.blocks[0].text == "FAQ"
    assert any(block.kind == "list_item" for block in document.blocks)
    assert any(block.kind == "qa_pair" and "What if the reset fails?" in block.text for block in document.blocks)


def test_docx_parser_marks_heading_styles_lists_and_tables() -> None:
    document = DocxParser().parse(build_docx_bytes(), "guide.docx")

    assert document.file_type == "docx"
    assert document.blocks[0].kind == "heading"
    assert document.blocks[0].metadata["heading_level"] == 1
    assert any(block.kind == "list_item" and block.text.startswith("- ") for block in document.blocks)
    assert any(block.kind == "table_row" and "Signal: Queue depth" in block.text for block in document.blocks)
    assert document.metadata["table_row_count"] == 2


def test_pdf_parser_extracts_page_numbers_and_structure() -> None:
    document = PdfParser().parse(build_pdf_bytes(), "guide.pdf")

    assert document.file_type == "pdf"
    assert document.metadata["page_mapping_available"] is True
    assert any(block.page_number == 1 for block in document.blocks)
    assert any(block.page_number == 2 for block in document.blocks)
    assert any(block.kind == "heading" and block.text == "Runbook" for block in document.blocks)
    assert any("Page two contains escalation instructions." in block.text for block in document.blocks)


def test_pdf_parser_removes_repeated_headers_and_footers() -> None:
    document = PdfParser().parse(build_pdf_with_repeated_margins_bytes(), "noise.pdf")

    all_text = " ".join(block.text for block in document.blocks)
    assert "Support Copilot Runbook" not in all_text
    assert "Page 1 of 3" not in all_text
    assert "Page 2 of 3" not in all_text
    assert "Reset the account and capture the request id." in all_text
    assert "repeated_page_margins_removed" in document.metadata["extraction_warnings"]
