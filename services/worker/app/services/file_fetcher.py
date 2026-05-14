import asyncio
import hashlib

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.core.settings import Settings
from app.services.errors import IngestionError, IngestionErrorCode


class FileFetcher:
    def __init__(self, settings: Settings) -> None:
        self._client = boto3.client(
            "s3",
            region_name=settings.s3_region,
            endpoint_url=settings.s3_endpoint,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )

    async def fetch_bytes(self, bucket: str, key: str) -> bytes:
        try:
            return await asyncio.to_thread(self._read_bytes, bucket, key)
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code", "")
            if error_code in {"NoSuchKey", "404", "NoSuchBucket"}:
                raise IngestionError(
                    code=IngestionErrorCode.FILE_NOT_FOUND,
                    message="Requested object was not found",
                    retryable=False,
                    details={
                        "bucket": bucket,
                        "object_key_hash": self._hash_key(key),
                        "provider_error": error_code,
                    },
                ) from exc
            raise IngestionError(
                code=IngestionErrorCode.OBJECT_STORAGE_FAILED,
                message="Object storage request failed",
                retryable=True,
                details={
                    "bucket": bucket,
                    "object_key_hash": self._hash_key(key),
                    "provider_error": error_code,
                },
            ) from exc
        except BotoCoreError as exc:
            raise IngestionError(
                code=IngestionErrorCode.OBJECT_STORAGE_FAILED,
                message="Object storage client failed",
                retryable=True,
                details={"bucket": bucket, "object_key_hash": self._hash_key(key)},
            ) from exc

    async def check_bucket(self, bucket: str) -> None:
        try:
            await asyncio.to_thread(self._client.head_bucket, Bucket=bucket)
        except (ClientError, BotoCoreError) as exc:
            raise IngestionError(
                code=IngestionErrorCode.OBJECT_STORAGE_FAILED,
                message=f"Bucket {bucket} is not ready",
                retryable=True,
                details={"bucket": bucket},
            ) from exc

    def _read_bytes(self, bucket: str, key: str) -> bytes:
        response = self._client.get_object(Bucket=bucket, Key=key)
        return response["Body"].read()

    def _hash_key(self, key: str) -> str:
        return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
