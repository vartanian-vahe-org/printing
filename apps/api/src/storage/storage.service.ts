import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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

  onApplicationShutdown() {
    this.client.destroy();
    this.presignClient.destroy();
  }
}
