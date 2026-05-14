const TEST_DATABASE_URL = 'postgresql://test_user:test_password@localhost:5432/test_db';
const TEST_JWT_SECRET = 'test-jwt-secret-32-characters-minimum';

function isTestRuntime() {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
}

function readEnv(name: string) {
  const value = process.env[name];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function getRequiredEnv(name: string, testDefault?: string) {
  const value = readEnv(name);
  if (value) {
    return value;
  }
  if (isTestRuntime() && testDefault) {
    return testDefault;
  }
  throw new Error(`Missing required environment variable ${name}`);
}

function parseIntegerEnv(name: string, defaultValue: number, min: number, max: number) {
  const raw = readEnv(name);
  if (!raw) {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(
      `Environment variable ${name} must be an integer between ${min} and ${max}`,
    );
  }

  return parsed;
}

function parseFloatEnv(name: string, defaultValue: number, min: number, max: number) {
  const raw = readEnv(name);
  if (!raw) {
    return defaultValue;
  }

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(
      `Environment variable ${name} must be a number between ${min} and ${max}`,
    );
  }

  return parsed;
}

function parseBooleanEnv(name: string, defaultValue: boolean) {
  const raw = readEnv(name);
  if (!raw) {
    return defaultValue;
  }

  if (/^(true|1|yes|on)$/i.test(raw)) {
    return true;
  }

  if (/^(false|0|no|off)$/i.test(raw)) {
    return false;
  }

  throw new Error(`Environment variable ${name} must be a boolean`);
}

export function getDatabaseUrl() {
  return getRequiredEnv('DATABASE_URL', TEST_DATABASE_URL);
}

export function getJwtSecret() {
  const secret = getRequiredEnv('JWT_SECRET', TEST_JWT_SECRET);
  if (secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long');
  }
  if (/super-secret|production-secret-should-be-here|change-?me|default/i.test(secret)) {
    throw new Error('JWT_SECRET must not use a placeholder or known default value');
  }
  return secret;
}

export function getJwtIssuer() {
  return readEnv('JWT_ISSUER') ?? 'rag-backend-api';
}

export function getJwtAudience() {
  return readEnv('JWT_AUDIENCE') ?? 'rag-backend-clients';
}

export function getJwtAccessTtl() {
  return readEnv('JWT_ACCESS_TTL') ?? '60m';
}

export function getJwtRefreshTtl() {
  return readEnv('JWT_REFRESH_TTL') ?? '30d';
}

export function getBcryptRounds() {
  return parseIntegerEnv('BCRYPT_ROUNDS', 12, 10, 15);
}

export function getRedisHost() {
  return getRequiredEnv('REDIS_HOST', 'localhost');
}

export function getRedisPort() {
  return parseIntegerEnv('REDIS_PORT', 6379, 1, 65535);
}

export function getS3Endpoint() {
  return getUrlEnv('S3_ENDPOINT', 'http://localhost:9000');
}

export function getS3Bucket() {
  return getRequiredEnv('S3_BUCKET', 'knowledge-base-bucket');
}

export function getAwsAccessKeyId() {
  return getRequiredEnv('AWS_ACCESS_KEY_ID', 'test-access-key');
}

export function getAwsSecretAccessKey() {
  return getRequiredEnv('AWS_SECRET_ACCESS_KEY', 'test-secret-key');
}

export function getUploadMaxBytes() {
  return parseIntegerEnv('UPLOAD_MAX_BYTES', 10 * 1024 * 1024, 1_048_576, 52_428_800);
}

export function getCorsOrigins() {
  const raw = readEnv('CORS_ORIGINS');
  if (!raw) {
    return [];
  }

  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  origins.forEach((origin) => {
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error();
      }
    } catch {
      throw new Error(`CORS_ORIGINS contains an invalid origin: ${origin}`);
    }
  });

  return origins;
}

export function getOpenAiApiKey() {
  return readEnv('OPENAI_API_KEY');
}

export function getOpenAiEmbeddingModel() {
  return readEnv('OPENAI_EMBEDDING_MODEL') ?? 'text-embedding-3-small';
}

export function getOpenAiChatModel() {
  return readEnv('OPENAI_CHAT_MODEL') ?? 'gpt-5';
}

export function getOpenAiRequestTimeoutMs() {
  return parseIntegerEnv('OPENAI_REQUEST_TIMEOUT_MS', 30000, 1000, 180000);
}

export function getOpenAiMaxRetries() {
  return parseIntegerEnv('OPENAI_MAX_RETRIES', 2, 0, 5);
}

export function getOpenAiRetryBaseDelayMs() {
  return parseIntegerEnv('OPENAI_RETRY_BASE_DELAY_MS', 250, 0, 5000);
}

export function getOpenAiGroundingMaxChunks() {
  return parseIntegerEnv('OPENAI_GROUNDED_CHAT_MAX_CHUNKS', 6, 1, 20);
}

export function getOpenAiTemperature() {
  return parseFloatEnv('OPENAI_TEMPERATURE', 0.1, 0, 2);
}

export function isOpenAiEmbeddingsEnabled() {
  return parseBooleanEnv('OPENAI_EMBEDDINGS_ENABLED', true);
}

export function isOpenAiGroundedChatEnabled() {
  return parseBooleanEnv('OPENAI_GROUNDED_CHAT_ENABLED', true);
}

export function isOpenAiEmbeddingsAvailable() {
  return Boolean(getOpenAiApiKey()) && isOpenAiEmbeddingsEnabled();
}

export function isOpenAiGroundedChatAvailable() {
  return Boolean(getOpenAiApiKey()) && isOpenAiGroundedChatEnabled();
}

export function validateRuntimeConfig() {
  getDatabaseUrl();
  getJwtSecret();
  getRedisHost();
  getRedisPort();
  getS3Endpoint();
  getS3Bucket();
  getAwsAccessKeyId();
  getAwsSecretAccessKey();
  getUploadMaxBytes();
  getCorsOrigins();
  getOpenAiEmbeddingModel();
  getOpenAiChatModel();
  getOpenAiRequestTimeoutMs();
  getOpenAiMaxRetries();
  getOpenAiRetryBaseDelayMs();
  getOpenAiGroundingMaxChunks();
  getOpenAiTemperature();
  isOpenAiEmbeddingsEnabled();
  isOpenAiGroundedChatEnabled();
}

export function describeRuntimeConfig() {
  return {
    corsEnabled: getCorsOrigins().length > 0,
    jwtAudience: getJwtAudience(),
    jwtConfigured: Boolean(readEnv('JWT_SECRET')),
    jwtIssuer: getJwtIssuer(),
    openAiApiKeyConfigured: Boolean(getOpenAiApiKey()),
    openAiChatAvailable: isOpenAiGroundedChatAvailable(),
    openAiChatEnabled: isOpenAiGroundedChatEnabled(),
    openAiChatModel: getOpenAiChatModel(),
    openAiEmbeddingModel: getOpenAiEmbeddingModel(),
    openAiEmbeddingsAvailable: isOpenAiEmbeddingsAvailable(),
    openAiEmbeddingsEnabled: isOpenAiEmbeddingsEnabled(),
    redisConfigured: Boolean(readEnv('REDIS_HOST')),
    redisPort: getRedisPort(),
    s3BucketConfigured: Boolean(readEnv('S3_BUCKET')),
    s3EndpointConfigured: Boolean(readEnv('S3_ENDPOINT')),
  };
}

function getUrlEnv(name: string, testDefault?: string) {
  const value = getRequiredEnv(name, testDefault);
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error();
    }
  } catch {
    throw new Error(`Environment variable ${name} must be a valid http or https URL`);
  }
  return value;
}
