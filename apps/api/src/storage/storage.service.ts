import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { DeleteObjectsCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, ListObjectsV2Command, NotFound, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';

function s3Client(endpoint: string | undefined) {
  return new S3Client({
    endpoint,
    region: config.s3.region,
    forcePathStyle: config.s3.forcePathStyle,
    credentials: {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
    },
  });
}

@Injectable()
export class StorageService implements OnApplicationShutdown {
  /** Server-to-storage calls. */
  private readonly client = s3Client(config.s3.endpoint);
  /** Only signs URLs the browser will call, so it uses the public endpoint. */
  private readonly presignClient = s3Client(config.s3.publicEndpoint);

  async checkBucket(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
  }

  /** Size and content type of an uploaded object, or null when it does not exist. */
  async describe(key: string): Promise<{ sizeBytes: number; contentType: string | undefined } | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: config.s3.bucket, Key: key }));
      return { sizeBytes: head.ContentLength ?? 0, contentType: head.ContentType };
    } catch (err) {
      if (err instanceof NotFound || (err as { name?: string }).name === 'NotFound') return null;
      throw err;
    }
  }

  /**
   * Presigned PUT that only accepts exactly this content type and size,
   * so the browser cannot upload something else with the same URL.
   */
  async presignPut(key: string, contentType: string, sizeBytes: number, expiresInSeconds: number): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
    });
    return getSignedUrl(this.presignClient, command, {
      expiresIn: expiresInSeconds,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
  }

  /** Every object under a prefix with its last-modified time (paged by S3, 1000 at a time). */
  async *list(prefix: string): AsyncGenerator<{ key: string; lastModified: Date }> {
    let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: config.s3.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const object of page.Contents ?? []) {
        if (object.Key && object.LastModified) yield { key: object.Key, lastModified: object.LastModified };
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }

  async deleteMany(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      await this.client.send(new DeleteObjectsCommand({ Bucket: config.s3.bucket, Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true } }));
    }
  }

  /** Server-side upload (generated print files). */
  async write(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: bytes, ContentType: contentType }));
  }

  /** Whole object as bytes (customer files are small: logos, card PDFs up to the upload limit). */
  async read(key: string): Promise<Uint8Array> {
    const object = await this.client.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    if (!object.Body) throw new Error(`Empty object: ${key}`);
    return object.Body.transformToByteArray();
  }

  /**
   * Short-lived link to a private object: a download saved as `fileName` (staff downloads of customer
   * files), or 'inline' for images shown on a page (proofs).
   */
  async presignGet(key: string, fileName: string, expiresInSeconds: number, disposition: 'attachment' | 'inline' = 'attachment'): Promise<string> {
    const safeName = fileName.replace(/[^\w.\- ]+/g, '_').slice(0, 150) || 'file';
    const command = new GetObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      ResponseContentDisposition: `${disposition}; filename="${safeName}"`,
    });
    return getSignedUrl(this.presignClient, command, { expiresIn: expiresInSeconds });
  }

  onApplicationShutdown() {
    this.client.destroy();
    this.presignClient.destroy();
  }
}
