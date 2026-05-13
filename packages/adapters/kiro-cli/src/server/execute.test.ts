import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import { buildKiroCommandArgs, trustArgs } from "./command.js";
import { buildKiroEnv, parseKiroEnv, redactEnv } from "./shared.js";
import { execute } from "./execute.js";

const { runChildProcess, runKiroAcp } = vi.hoisted(() => ({
  runChildProcess: vi.fn(),
  runKiroAcp: vi.fn(),
}));

vi.mock("@paperclipai/adapter-utils/server-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@paperclipai/adapter-utils/server-utils")>();
  return {
    ...actual,
    ensureCommandResolvable: vi.fn(async () => undefined),
    runChildProcess,
  };
});

vi.mock("./acp.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./acp.js")>();
  return {
    ...actual,
    runKiroAcp,
  };
});

function baseCtx(config: Record<string, unknown>, cwd: string): AdapterExecutionContext {
  return {
    runId: "run-1",
    agent: { id: "agent-1", companyId: "company-1", name: "Kiro", adapterType: "kiro_cli", adapterConfig: config },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config,
    context: { paperclipWorkspace: { cwd } },
    onLog: vi.fn(async () => undefined),
    onMeta: vi.fn(async () => undefined),
    onSpawn: vi.fn(async () => undefined),
  };
}

describe("kiro_cli execute", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(os.tmpdir(), "paperclip-kiro-test-"));
    runChildProcess.mockReset();
    runKiroAcp.mockReset();
  });

  it("mode auto tries ACP first", async () => {
    runKiroAcp.mockResolvedValue({ exitCode: 0, signal: null, text: "ok", sessionId: "s1", timedOut: false });
    const result = await execute(baseCtx({ integrationMode: "auto", promptTemplate: "hello" }, cwd));
    expect(runKiroAcp).toHaveBeenCalledTimes(1);
    expect(runChildProcess).not.toHaveBeenCalled();
    expect(result.sessionId).toBe("s1");
  });

  it("mode acp does not fallback", async () => {
    runKiroAcp.mockRejectedValue(new Error("acp failed"));
    const result = await execute(baseCtx({ integrationMode: "acp", promptTemplate: "hello" }, cwd));
    expect(runChildProcess).not.toHaveBeenCalled();
    expect(result.errorMessage).toBe("acp failed");
  });

  it("mode command builds chat --no-interactive", async () => {
    runChildProcess.mockResolvedValue({ exitCode: 0, signal: null, timedOut: false, stdout: "done", stderr: "", pid: 123, startedAt: "now" });
    await execute(baseCtx({ integrationMode: "command", promptTemplate: "hello" }, cwd));
    expect(runChildProcess.mock.calls[0][2]).toEqual(["chat", "--no-interactive", "--trust-tools=read,grep", "hello"]);
  });

  it("read_only maps to --trust-tools=read,grep", () => {
    expect(trustArgs({ approvalMode: "read_only" })).toEqual(["--trust-tools=read,grep"]);
  });

  it("trust_all maps to --trust-all-tools", () => {
    expect(trustArgs({ approvalMode: "trust_all" })).toEqual(["--trust-all-tools"]);
  });

  it("requireMcpStartup prepends --require-mcp-startup", () => {
    expect(trustArgs({ requireMcpStartup: true, approvalMode: "read_only" })).toEqual(["--require-mcp-startup", "--trust-tools=read,grep"]);
  });

  it("env allowlist allows KIRO_API_KEY and redacts it in metadata", () => {
    expect(parseKiroEnv({ KIRO_API_KEY: "secret" })).toEqual({ KIRO_API_KEY: "secret" });
    expect(() => parseKiroEnv({ AWS_SECRET_ACCESS_KEY: "secret" })).toThrow("Environment variable AWS_SECRET_ACCESS_KEY is not allowed for kiro_cli.");
    expect(redactEnv(buildKiroEnv({ env: { KIRO_API_KEY: "secret" } })).KIRO_API_KEY).toBe("***REDACTED***");
  });

  it("builds command args with configured trust tools and extra args", () => {
    expect(buildKiroCommandArgs({ approvalMode: "configured", trustTools: "read,write", extraArgs: '["--foo"]' }, "prompt")).toEqual([
      "chat",
      "--no-interactive",
      "--trust-tools=read,write",
      "--foo",
      "prompt",
    ]);
  });
});