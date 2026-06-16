/*
 * Ambient module declarations for runtime dependencies that ship no TypeScript
 * types and have no @types package on DefinitelyTyped. Each is small and
 * stable; a bare declaration types the import as `any`, which is acceptable for
 * these. (`dot` is only used by the legacy website templates and will be
 * dropped once the Vite + React SPA lands.)
 */
declare module 'dot';
declare module 'node-json-minify';
declare module 'nonce';
