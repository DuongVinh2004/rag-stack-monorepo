from __future__ import annotations

from app.services.errors import IngestionError, IngestionErrorCode
from app.services.parsers.base import Parser, parse_docx_xml_signature
from app.services.parsers.docx_parser import DocxParser
from app.services.parsers.pdf_parser import PdfParser
from app.services.parsers.txt_parser import TxtParser


class ParserFactory:
    def __init__(self) -> None:
        self._parsers: dict[str, Parser] = {
            "pdf": PdfParser(),
            "docx": DocxParser(),
            "txt": TxtParser(),
        }

    def detect_file_type(self, data: bytes, mime_type: str, s3_key: str) -> str:
        lower_key = s3_key.lower()
        declared_pdf = mime_type == "application/pdf" or lower_key.endswith(".pdf")
        declared_docx = (
            mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            or lower_key.endswith(".docx")
        )
        declared_text = mime_type == "text/plain" or lower_key.endswith(".txt")

        if data.startswith(b"%PDF-"):
            return "pdf"
        if parse_docx_xml_signature(data):
            return "docx"
        if self._looks_like_text(data) and (declared_text or not declared_pdf and not declared_docx):
            return "txt"
        raise IngestionError(
            code=IngestionErrorCode.UNSUPPORTED_FILE_TYPE,
            message="Unsupported file type",
            retryable=False,
            details={"mime_type": mime_type, "declared_extension": lower_key.rsplit(".", 1)[-1]},
        )

    def get_parser(self, file_type: str) -> Parser:
        try:
            return self._parsers[file_type]
        except KeyError as exc:
            raise IngestionError(
                code=IngestionErrorCode.UNSUPPORTED_FILE_TYPE,
                message=f"No parser is configured for file type {file_type}",
                retryable=False,
            ) from exc

    def _looks_like_text(self, data: bytes) -> bool:
        if not data:
            return True
        if b"\x00" in data[:2048]:
            return False
        try:
            data[:2048].decode('utf-8')
            return True
        except UnicodeDecodeError:
            pass
        # Fallback to ascii check if utf-8 fails
        sample = data[:2048]
        printable = sum(1 for byte in sample if byte in {9, 10, 13} or 32 <= byte <= 126)
        return printable / max(len(sample), 1) > 0.9
