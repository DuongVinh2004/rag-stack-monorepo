import { BadRequestException } from '@nestjs/common';
import {
  inspectUploadedDocument,
  sanitizeDisplayName,
} from './document-upload.helpers';

describe('document-upload.helpers', () => {
  it('detects a valid text upload and sanitizes the storage filename', () => {
    const inspected = inspectUploadedDocument({
      originalname: ' Worker Notes .txt ',
      mimetype: 'text/plain',
      buffer: Buffer.from('Reset the worker before retrying the failed job.'),
    } as Express.Multer.File);

    expect(inspected.mimeType).toBe('text/plain');
    expect(inspected.storageFilename).toBe('Worker-Notes.txt');
  });

  it('rejects mismatched file extensions and content', () => {
    expect(() =>
      inspectUploadedDocument({
        originalname: 'mismatch.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('%PDF-1.4 fake'),
      } as Express.Multer.File),
    ).toThrow(BadRequestException);
  });

  it('normalizes display names without changing the user-visible behavior', () => {
    expect(sanitizeDisplayName('  Worker   Runbook \u0000 ')).toBe('Worker Runbook');
  });
});
