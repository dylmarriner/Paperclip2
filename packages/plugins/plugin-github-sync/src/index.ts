/**
 * Package entry. Re-exports the manifest so tooling that resolves
 * `@paperclipai/plugin-github-sync` can read the manifest without importing
 * the built worker bundle.
 *
 * The runtime worker entry point is `dist/worker.js`, declared as
 * `paperclipPlugin.worker` in package.json. The worker lands in Commit C.
 */
export { default as manifest } from "./manifest.js";
export * from "./constants.js";
export type { GitHubSyncConfig } from "./config/schema.js";
