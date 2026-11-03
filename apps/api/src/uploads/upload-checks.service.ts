import { randomUUID } from 'node:crypto';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../config.js';

const QUEUE = 'upload-checks';

export interface UploadCheckInput {
  /** The file as uploaded (artwork/…, any accepted type). */
  sourceKey: string;
  /** Where the worker stores the print PDF made from it. */
  outputKey: string;
  geometry: { widthIn: number; heightIn: number; bleedIn: number; safeIn: number };
  /** 'back' for a separate back file: its only page is the back. */
  side: 'front' | 'back';
  /** Pages that are printed from this file: 2 when the front file also holds the back. */
  maxPages: 1 | 2;
}

export interface UploadCheckResult {
  format: string;
  issues: { code: string; level: 'error' | 'warning'; message: string; page?: number }[];
  pageCount: number;
  outputKey: string | null;
}

export type UploadCheckView = { status: 'checking' } | { status: 'failed' } | ({ status: 'done' } & UploadCheckResult);

/**
 * Checks a customer's file right after upload, before it can go in the cart: the Python prepress
 * worker turns it into a print PDF and checks it (resolution, CMYK, fonts, size). The storefront
 * polls for the result by the check id.
 */
@Injectable()
export class UploadChecksService implements OnModuleInit, OnModuleDestroy {
  private queue!: Queue<UploadCheckInput, UploadCheckResult>;

  onModuleInit() {
    this.queue = new Queue(QUEUE, {
      connection: new Redis(config.redisUrl, { maxRetriesPerRequest: null }),
      defaultJobOptions: { attempts: 2, removeOnComplete: { age: 24 * 3600 }, removeOnFail: { age: 24 * 3600 } },
    });
  }

  async onModuleDestroy() {
    await this.queue?.close();
  }

  async start(input: UploadCheckInput): Promise<string> {
    const id = randomUUID();
    await this.queue.add('check', input, { jobId: id });
    return id;
  }

  /** null for an unknown (or expired) check id. */
  async view(id: string): Promise<UploadCheckView | null> {
    const job = await this.queue.getJob(id);
    if (!job) return null;
    const state = await job.getState();
    if (state === 'completed') return { status: 'done', ...job.returnvalue };
    if (state === 'failed') return { status: 'failed' };
    return { status: 'checking' };
  }
}
