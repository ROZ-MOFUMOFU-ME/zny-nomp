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

// Optional runtime add-ons loaded via dynamic import() in init.ts; not declared
// dependencies, so make their bare specifiers resolvable as `any`.
declare module 'newrelic';
declare module 'posix';

// node-json-minify installs JSON.minify at runtime (see init.ts); declare it on
// the global JSON object so call sites typecheck.
interface JSON {
    minify(json: string): string;
}
