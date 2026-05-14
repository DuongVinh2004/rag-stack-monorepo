import { Injectable, Logger } from '@nestjs/common';
import { HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as crypto from 'crypto';
import {
  getAwsAccessKeyId,
  getAwsSecretAccessKey,
  getS3Endpoint,
} from '../../config/runtime-config';

@Injectable()
export class StorageService {
  private s3: S3Client;
  private readonly logger = new Logger(StorageService.name);

  constructor() {
    this.s3 = new S3Client({
      region: 'us-east-1',
      endpoint: getS3Endpoint(),
      credentials: {
        accessKeyId: getAwsAccessKeyId(),
        secretAccessKey: getAwsSecretAccessKey(),
      },
      forcePathStyle: true,
    });
  }

  async uploadFile(bucket: string, key: string, buffer: Buffer, mimetype: string) {
    try {
      await this.s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        CacheControl: 'private, no-store, max-age=0',
        ContentDisposition: 'attachment',
        ContentType: mimetype,
      }));
      return key;
    } catch (e) {
      this.logger.error(
        {
          bucket,
          event: 'object_storage_upload_failed',
          mimetype,
          object_key_hash: this.hashKey(key),
        },
        e instanceof Error ? e.stack : undefined,
      );
      throw e;
    }
  }

  async checkBucket(bucket: string) {
    try {
      await this.s3.send(
        new HeadBucketCommand({
          Bucket: bucket,
        }),
      );
      return true;
    } catch (error) {
      this.logger.error(
        {
          bucket,
          endpoint: getS3Endpoint(),
          event: 'object_storage_bucket_check_failed',
        },
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  private hashKey(value: string) {
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
  }
}
