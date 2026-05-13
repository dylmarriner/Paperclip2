import type { AdapterEnvironmentCheck, AdapterEnvironmentTestContext, AdapterEnvironmentTestResult } from "@paperclipai/adapter-utils";
import { asString, ensureCommandResolvable, parseObject, runChildProcess } from "@paperclipai/adapter-utils/server-utils";
import { DEFAULT_KIRO_EXECUTABLE } from "../index.js";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

export async function testEnvironment(ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.executablePath, DEFAULT_KIRO_EXECUTABLE).trim() || DEFAULT_KIRO_EXECUTABLE;
  const env = { PATH: process.env.PATH ?? "" };

  try {
    await ensureCommandResolvable(command, process.cwd(), env);
    const version = await runChildProcess(`test-${ctx.adapterType}`, command, ["--version"], {
      cwd: process.cwd(),
      env,
      timeoutSec: 10,
      graceSec: 2,
      onLog: async () => {},
    });
    if (version.exitCode === 0) {
      checks.push({ code: "kiro_version", level: "info", message: `Found Kiro CLI: ${(version.stdout || version.stderr).trim()}` });
    } else {
      checks.push({ code: "kiro_version_failed", level: "error", message: "Kiro CLI was found but --version failed.", detail: version.stderr || version.stdout });
    }
  } catch (error) {
    checks.push({
      code: "kiro_missing",
      level: "error",
      message: "Kiro CLI is not available to Paperclip.",
      detail: error instanceof Error ? error.message : String(error),
      hint: "Install Kiro CLI and ensure `kiro-cli --version` works for the user running Paperclip, or set executablePath to the absolute binary path.",
    });
  }

  checks.push({
    code: "kiro_permissions",
    level: "warn",
    message: "Command fallback trust settings are controlled by adapter config.",
    hint: "Prefer ACP mode. Avoid trust_all unless the workspace is disposable or backed up.",
  });

  return { adapterType: ctx.adapterType, testedAt: new Date().toISOString(), checks, status: summarizeStatus(checks) };
}