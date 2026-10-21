#!/bin/sh
# Creates the upload bucket on the local S3-compatible storage and sets CORS
# so the browser can upload directly with presigned URLs. Safe to re-run.
set -eu

ENDPOINT="http://storage:9000"
s3api() { aws --endpoint-url "$ENDPOINT" s3api "$@"; }

echo "Waiting for storage at $ENDPOINT ..."
i=0
until aws --endpoint-url "$ENDPOINT" s3 ls >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "Storage did not become ready in time" >&2
    exit 1
  fi
  sleep 1
done

if s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  echo "Bucket $BUCKET already exists"
else
  s3api create-bucket --bucket "$BUCKET"
  echo "Created bucket $BUCKET"
fi

s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["http://localhost:3000", "http://localhost:5173"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }]
}'
echo "CORS configured for $BUCKET"
