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
  /** Storefront base URL, for links in emails (order page). */
  webUrl: required('WEB_URL').replace(/\/+$/, ''),
  /** Admin app base URL, for links in staff emails (password reset). */
  adminUrl: required('ADMIN_URL').replace(/\/+$/, ''),
  /** Shared with the sites' /api proxies on Vercel (@printing/api-proxy); unset when they run next to the API. */
  apiProxySecret: process.env.API_PROXY_SECRET || undefined,
  /** Encrypts secrets stored in the database (TOTP keys). Changing it disables existing 2FA. */
  dataEncryptionKey: required('DATA_ENCRYPTION_KEY'),
  /** Signs the private order links; changing it breaks links already emailed. */
  orderLinkSecret: required('ORDER_LINK_SECRET'),
  /** Any SMTP service: Mailpit locally; SES, Postmark or Resend in production (open issue S15). */
  mail: {
    smtpHost: required('SMTP_HOST'),
    smtpPort: Number(process.env.SMTP_PORT ?? 587),
    /** true = TLS from the start (port 465); false = STARTTLS when the server offers it. */
    smtpSecure: process.env.SMTP_SECURE === 'true',
    smtpUser: process.env.SMTP_USER || undefined,
    smtpPassword: process.env.SMTP_PASSWORD || undefined,
    /** Sender address; the display name comes from store settings. Must be verified with the SMTP service. */
    fromAddress: required('MAIL_FROM_ADDRESS'),
  },
  /** Send cookies (admin session, cart) over HTTPS only. Must be true outside local development. */
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  admin: {
    sessionDays: Number(process.env.ADMIN_SESSION_DAYS ?? 7),
  },
  customers: {
    sessionDays: 30,
    verifyLinkHours: 72,
    resetLinkMinutes: 60,
  },
  cart: {
    cookieDays: 30,
    maxItems: 50,
  },
  uploads: {
    /** Placeholder limit, see docs/open-issues.md S2. */
    maxBytes: Number(process.env.UPLOAD_MAX_MB ?? 50) * MB,
    presignExpiresSeconds: 15 * 60,
  },
};
