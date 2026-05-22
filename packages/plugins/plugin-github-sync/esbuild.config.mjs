// Build script for @paperclipai/plugin-github-sync.
//
// Mirrors the pattern used by @paperclipai/plugin-llm-wiki: load preset
// bundler configs from the plugin SDK and build the worker, manifest, and
// (later) UI bundles in parallel. Watch mode is opt-in via --watch.
//
// We deliberately do not invoke `tsc` here — typechecking runs separately
// via `pnpm typecheck` so the build step stays fast and unconditional.
//
// Phase 1 ships only worker + manifest bundles. The UI bundle entry
// (`src/ui/index.tsx`) is wired up but produces an empty bundle until the
// settings page lands in Phase 3.
import esbuild from "esbuild";
import { createPluginBundlerPresets } from "@paperclipai/plugin-sdk/bundlers";
import { existsSync } from "node:fs";

const watch = process.argv.includes("--watch");
const uiEntry = "src/ui/index.tsx";
const presets = createPluginBundlerPresets({ uiEntry });

const workerCtx = await esbuild.context(presets.esbuild.worker);
const manifestCtx = await esbuild.context(presets.esbuild.manifest);
const uiCtx = existsSync(uiEntry) ? await esbuild.context(presets.esbuild.ui) : null;

if (watch) {
  await Promise.all([
    workerCtx.watch(),
    manifestCtx.watch(),
    ...(uiCtx ? [uiCtx.watch()] : []),
  ]);
  console.log("esbuild watch mode enabled for worker, manifest" + (uiCtx ? ", and ui" : ""));
} else {
  await Promise.all([
    workerCtx.rebuild(),
    manifestCtx.rebuild(),
    ...(uiCtx ? [uiCtx.rebuild()] : []),
  ]);
  await Promise.all([
    workerCtx.dispose(),
    manifestCtx.dispose(),
    ...(uiCtx ? [uiCtx.dispose()] : []),
  ]);
}
