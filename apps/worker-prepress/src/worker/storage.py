"""S3 access (RustFS locally, AWS S3 in production), configured like the API."""

from __future__ import annotations

import os

import boto3
from botocore.config import Config


class Storage:
    def __init__(self) -> None:
        self.bucket = os.environ["S3_BUCKET"]
        self.client = boto3.client(
            "s3",
            endpoint_url=os.environ.get("S3_ENDPOINT") or None,
            region_name=os.environ["S3_REGION"],
            aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
            config=Config(s3={"addressing_style": "path" if os.environ.get("S3_FORCE_PATH_STYLE") == "true" else "auto"}),
        )

    def read(self, key: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def write_png(self, key: str, data: bytes) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType="image/png")
