export enum DocumentStatus {
  UPLOADED = 'UPLOADED',
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  INDEXED = 'INDEXED',
  FAILED = 'FAILED',
  ARCHIVED = 'ARCHIVED',
}

export enum IngestJobStatus {
  WAITING = 'WAITING',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  DEAD_LETTER = 'DEAD_LETTER',
}

export enum DocumentVersionStatus {
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  INDEXED = 'INDEXED',
  FAILED = 'FAILED',
}

export enum VectorizationStatus {
  PENDING = 'PENDING',
  DISABLED = 'DISABLED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum IngestErrorCode {
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  UNSUPPORTED_FILE_TYPE = 'UNSUPPORTED_FILE_TYPE',
  FILE_PARSE_FAILED = 'FILE_PARSE_FAILED',
  EMPTY_DOCUMENT = 'EMPTY_DOCUMENT',
  NORMALIZATION_FAILED = 'NORMALIZATION_FAILED',
  CHUNKING_FAILED = 'CHUNKING_FAILED',
  EMBEDDING_API_FAILED = 'EMBEDDING_API_FAILED',
  VECTOR_PERSIST_FAILED = 'VECTOR_PERSIST_FAILED',
  DB_WRITE_FAILED = 'DB_WRITE_FAILED',
  OBJECT_STORAGE_FAILED = 'OBJECT_STORAGE_FAILED',
  TRANSIENT_EXTERNAL_ERROR = 'TRANSIENT_EXTERNAL_ERROR',
  QUEUE_ENQUEUE_FAILED = 'QUEUE_ENQUEUE_FAILED',
}

export interface IngestQueueJobPayload {
  ingestJobId: string;
  documentId: string;
  documentVersionId: string;
  kbId: string;
  bucket: string;
  s3Key: string;
  mimeType: string;
  sourceTitle: string;
  correlationId?: string;
  pipelineVersion: string;
  ingestVersion: number;
}

export enum KbVisibility {
  PRIVATE = 'PRIVATE',
  INTERNAL = 'INTERNAL',
  PUBLIC = 'PUBLIC',
}

export enum KbRole {
  OWNER = 'OWNER',
  EDITOR = 'EDITOR',
  VIEWER = 'VIEWER',
}

export enum SystemRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  SYSTEM = 'SYSTEM',
  USER = 'USER',
}

export enum ConversationStatus {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

export enum MessageRole {
  USER = 'USER',
  ASSISTANT = 'ASSISTANT',
  SYSTEM = 'SYSTEM',
}

export enum ChatAnswerStatus {
  GROUNDED = 'grounded',
  INSUFFICIENT_DATA = 'insufficient_data',
  OUT_OF_SCOPE = 'out_of_scope',
}
