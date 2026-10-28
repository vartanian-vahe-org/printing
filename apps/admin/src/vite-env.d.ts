/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_STOREFRONT_URL?: string;
  /** Comma-separated admin pages to hide (src/features.ts). */
  readonly VITE_HIDDEN_FEATURES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
