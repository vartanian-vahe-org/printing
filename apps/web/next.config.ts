import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Docker image (EC2): self-contained server. Vercel builds its own output.
  output: process.env.VERCEL ? undefined : 'standalone',
  // Monorepo: trace files from the repo root so the build includes workspace packages.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  async headers() {
    // Demo and staging deployments stay out of search engines (SITE_NOINDEX=true).
    return process.env.SITE_NOINDEX === 'true' ? [{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }] : [];
  },
};

export default nextConfig;
