function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const MB = 1024 * 1024;

export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  databaseUrl: required('DATABASE_URL'),
  redisUrl: required('REDIS_URL'),
  s3: {
    endpoint: process.env.S3_ENDPOINT || undefined,
    /** Endpoint the browser uses for presigned URLs. Locally the API reaches storage at
     *  http://storage:9000 but the browser needs http://localhost:9000. Unset on AWS. */
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT || undefined,
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  },
  uploads: {
    /** Placeholder limit, see docs/open-issues.md S2. */
    maxBytes: Number(process.env.UPLOAD_MAX_MB ?? 50) * MB,
    presignExpiresSeconds: 15 * 60,
  },
};
