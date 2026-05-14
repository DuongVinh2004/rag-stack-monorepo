import { BadRequestException } from '@nestjs/common';
import * as path from 'path';

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME_TYPE = 'application/pdf';
const TEXT_MIME_TYPE = 'text/plain';
const SUPPORTED_MIME_TYPES = new Set([PDF_MIME_TYPE, TEXT_MIME_TYPE, DOCX_MIME_TYPE]);

export function inspectUploadedDocument(file: Express.Multer.File) {
  const storageFilename = sanitizeStorageFilename(file.originalname);
  const extension = path.extname(storageFilename).toLowerCase();
  const extensionMimeType = extensionToMimeType(extension);
  const detectedMimeType = detectMimeType(file.buffer);
  const declaredMimeType = normalizeDeclaredMimeType(file.mimetype);

  if (!extensionMimeType || !detectedMimeType) {
    throw new BadRequestException('Unsupported file type');
  }
  if (extensionMimeType !== detectedMimeType) {
    throw new BadRequestException('File extension does not match file content');
  }
  if (declaredMimeType && declaredMimeType !== detectedMimeType) {
    throw new BadRequestException('Declared MIME type does not match file content');
  }

  return {
    mimeType: detectedMimeType,
    storageFilename,
  };
}

export function sanitizeDisplayName(name: string) {
  const normalized = name
    .normalize('NFKC')
    .split('')
    .map((character) => (isControlCharacter(character) ? ' ' : character))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    throw new BadRequestException('Document name is required');
  }
  return normalized.slice(0, 200);
}

function detectMimeType(buffer: Buffer) {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return PDF_MIME_TYPE;
  }

  const hasZipHeader =
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    [0x03, 0x05, 0x07].includes(buffer[2]) &&
    [0x04, 0x06, 0x08].includes(buffer[3]);
  if (
    hasZipHeader &&
    buffer.includes(Buffer.from('[Content_Types].xml')) &&
    buffer.includes(Buffer.from('word/document.xml'))
  ) {
    return DOCX_MIME_TYPE;
  }

  if (isLikelyTextBuffer(buffer)) {
    return TEXT_MIME_TYPE;
  }

  return null;
}

function isLikelyTextBuffer(buffer: Buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let suspiciousByteCount = 0;

  for (const byte of sample) {
    if (byte === 0) {
      return false;
    }

    const isWhitespace = byte === 9 || byte === 10 || byte === 13;
    const isPrintableAscii = byte >= 32 && byte <= 126;
    const isExtendedText = byte >= 128;
    if (!isWhitespace && !isPrintableAscii && !isExtendedText) {
      suspiciousByteCount += 1;
    }
  }

  return suspiciousByteCount / Math.max(sample.length, 1) < 0.02;
}

function extensionToMimeType(extension: string) {
  if (extension === '.pdf') {
    return PDF_MIME_TYPE;
  }
  if (extension === '.txt') {
    return TEXT_MIME_TYPE;
  }
  if (extension === '.docx') {
    return DOCX_MIME_TYPE;
  }
  return null;
}

function normalizeDeclaredMimeType(mimetype?: string) {
  if (!mimetype || mimetype === 'application/octet-stream') {
    return null;
  }
  const normalized = mimetype.toLowerCase();
  if (!SUPPORTED_MIME_TYPES.has(normalized)) {
    throw new BadRequestException('Unsupported declared MIME type');
  }
  return normalized;
}

function sanitizeStorageFilename(originalName?: string) {
  const basename = path.basename(originalName || 'document');
  const extension = path.extname(basename).toLowerCase();
  const stem = path
    .basename(basename, extension)
    .normalize('NFKC')
    .split('')
    .filter((character) => !isControlCharacter(character))
    .join('')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80);
  const safeExtension = extension.replace(/[^.a-z0-9]/g, '');

  if (!stem || !safeExtension) {
    throw new BadRequestException('Invalid file name');
  }

  return `${stem}${safeExtension}`;
}

function isControlCharacter(character: string) {
  const codePoint = character.codePointAt(0) ?? -1;
  return (codePoint >= 0 && codePoint <= 31) || codePoint === 127;
}
