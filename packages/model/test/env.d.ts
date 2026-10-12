// Minimal typing for Vite's import.meta.glob (avoids pulling vite/client or @types/node into the package).
interface ImportMeta {
  glob(pattern: string, opts: { query: string; import: string; eager: true }): Record<string, unknown>;
}
