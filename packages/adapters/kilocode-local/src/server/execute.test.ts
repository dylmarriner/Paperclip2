import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import { buildKilocodeEnv, parseKilocodeEnv, parseStringArrayJson, prepareKilocodeCommand } from "./cli.js";
import { execute, redactEnv, summarizeKilocodeFailure } from "./execute.js";

const { runChildProcess } = vi.hoisted(() => ({
  runChildProcess: vi.fn(),
}));

vi.mock("@paperclipai/adapter-utils/server-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@paperclipai/adapter-utils/server-utils")>();
  return {
    ...actual,
    ensureCommandResolvable: vi.fn(async () => undefined),
    runChildProcess,
  };
});

function baseCtx(config: Record<string, unknown>, cwd: string): AdapterExecutionContext {
  return {
    runId: "run-1",
    agent: { id: "agent-1", companyId: "company-1", name: "Kilo", adapterType: "kilocode_local", adapterConfig: config },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config,
    context: { paperclipWorkspace: { cwd } },
    onLog: vi.fn(async () => undefined),
    onMeta: vi.fn(async () => undefined),
    onSpawn: vi.fn(async () => undefined),
  };
}

describe("kilocode_local command preparation", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(os.tmpdir(), "paperclip-kilo-test-"));
    runChildProcess.mockReset();
  });

  it("validates extraArgs must be JSON string[]", () => {
    expect(() => parseStringArrayJson('["--foo"]', "extraArgs")).not.toThrow();
    expect(() => parseStringArrayJson('{"bad":true}', "extraArgs")).toThrow("extraArgs must be a JSON array of strings.");
    expect(() => parseStringArrayJson(["--foo", 1], "extraArgs")).toThrow("extraArgs must be a JSON array of strings.");
  });

  it("validates env allowlist blocks unexpected variables", () => {
    expect(() => parseKilocodeEnv({ KILO_PROVIDER: "kilocode" })).not.toThrow();
    expect(() => parseKilocodeEnv({ AWS_SECRET_ACCESS_KEY: "secret" })).toThrow("Environment variable AWS_SECRET_ACCESS_KEY is not allowed for kilocode_local.");
  });

  it("constructs kilo run --auto with extra args and rendered prompt", async () => {
    const ctx = baseCtx({ extraArgs: '["--mode","debug"]', promptTemplate: "hello {{agent.name}}" }, cwd);
    const prepared = await prepareKilocodeCommand(ctx);
    expect(prepared.executable).toBe("kilo");
    expect(prepared.args).toEqual(["run", "--auto", "--mode", "debug", "hello Kilo"]);
    expect(prepared.cwd).toBe(cwd);
  });

  it("sets provider, org id, and kilocode-specific model env", () => {
    const env = buildKilocodeEnv({ provider: "kilocode", model: "k2", organizationId: "org_1" });
    expect(env.KILO_PROVIDER).toBe("kilocode");
    expect(env.KILOCODE_MODEL).toBe("k2");
    expect(env.KILO_MODEL).toBeUndefined();
    expect(env.KILO_ORG_ID).toBe("org_1");
  });

  it("sets generic KILO_MODEL for non-kilocode provider", () => {
    const env = buildKilocodeEnv({ provider: "anthropic", model: "claude" });
    expect(env.KILO_MODEL).toBe("claude");
    expect(env.KILOCODE_MODEL).toBeUndefined();
  });

  it("returns success summary on exit 0", async () => {
    runChildProcess.mockResolvedValue({ exitCode: 0, signal: null, timedOut: false, stdout: "done", stderr: "", pid: 123, startedAt: "now" });
    const result = await execute(baseCtx({ promptTemplate: "do work" }, cwd));
    expect(result.errorMessage).toBeNull();
    expect(result.summary).toBe("done");
  });

  it("returns timeout error on timedOut or exit 124", () => {
    expect(summarizeKilocodeFailure({ exitCode: 0, timedOut: true, stdout: "", stderr: "" })).toContain("timed out");
    expect(summarizeKilocodeFailure({ exitCode: 124, timedOut: false, stdout: "", stderr: "" })).toContain("timed out");
  });

  it("returns actionable missing executable error", async () => {
    const utils = await import("@paperclipai/adapter-utils/server-utils");
    vi.mocked(utils.ensureCommandResolvable).mockRejectedValueOnce(new Error('Command not found in PATH: "kilo"'));
    const result = await execute(baseCtx({}, cwd));
    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toBe('Command not found in PATH: "kilo"');
  });

  it("redacts secret-like env keys in metadata", () => {
    expect(redactEnv({ KILOCODE_API_KEY: "secret", KILO_PROVIDER: "kilocode" })).toEqual({
      KILOCODE_API_KEY: "***REDACTED***",
      KILO_PROVIDER: "kilocode",
    });
  });
});