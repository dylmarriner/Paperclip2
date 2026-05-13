import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import {
  asString,
  ensureCommandResolvable,
  parseObject,
  runChildProcess,
} from "@paperclipai/adapter-utils/server-utils";
import { DEFAULT_KILOCODE_EXECUTABLE, adapterType } from "../index.js";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

export async function testEnvironment(ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.executablePath, DEFAULT_KILOCODE_EXECUTABLE).trim() || DEFAULT_KILOCODE_EXECUTABLE;
  const env = { PATH: process.env.PATH ?? "" };

  try {
    await ensureCommandResolvable(command, process.cwd(), env);
    const version = await runChildProcess(`test-${adapterType}`, command, ["--version"], {
      cwd: process.cwd(),
      env,
      timeoutSec: 10,
      graceSec: 2,
      onLog: async () => {},
    });
    if (version.exitCode === 0) {
      checks.push({ code: "kilocode_version", level: "info", message: `Found Kilo CLI: ${(version.stdout || version.stderr).trim()}` });
    } else {
      checks.push({ code: "kilocode_version_failed", level: "error", message: "Kilo CLI was found but --version failed.", detail: version.stderr || version.stdout });
    }
  } catch (error) {
    checks.push({
      code: "kilocode_missing",
      level: "error",
      message: "Kilo CLI is not available to Paperclip.",
      detail: error instanceof Error ? error.message : String(error),
      hint: "Install @kilocode/cli and ensure `kilo --version` works for the user running Paperclip, or set executablePath to the absolute binary path.",
    });
  }

  checks.push({
    code: "kilocode_permissions",
    level: "warn",
    message: "Autonomous Kilo runs use Kilo's own auto-approval rules.",
    hint: "Configure Kilo permissions before running production agents. Do not rely on Paperclip to approve shell commands inside Kilo.",
  });

  return { adapterType: ctx.adapterType, testedAt: new Date().toISOString(), checks, status: summarizeStatus(checks) };
}