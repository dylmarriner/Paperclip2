import { describe, expect, it, vi, beforeEach } from "vitest";
import { discoverKilocodeModels, parseKilocodeModelsOutput, resetKilocodeModelsCacheForTests } from "./models.js";

const { runChildProcess } = vi.hoisted(() => ({ runChildProcess: vi.fn() }));

vi.mock("@paperclipai/adapter-utils/server-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@paperclipai/adapter-utils/server-utils")>();
  return { ...actual, runChildProcess };
});

describe("kilocode model discovery", () => {
  beforeEach(() => {
    runChildProcess.mockReset();
    resetKilocodeModelsCacheForTests();
  });

  it("parses kilo models output", () => {
    expect(parseKilocodeModelsOutput("kilo/openai/gpt-latest\nkilo/anthropic/claude-sonnet-4.5\n")).toEqual([
      { id: "kilo/anthropic/claude-sonnet-4.5", label: "kilo/anthropic/claude-sonnet-4.5" },
      { id: "kilo/openai/gpt-latest", label: "kilo/openai/gpt-latest" },
    ]);
  });

  it("runs kilo models and parses stdout", async () => {
    runChildProcess.mockResolvedValue({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "kilo/kilo-auto/free\nkilo/openai/gpt-latest\n",
      stderr: "",
      pid: 1,
      startedAt: "now",
    });
    const models = await discoverKilocodeModels({ command: "kilo", cwd: process.cwd() });
    expect(runChildProcess.mock.calls[0][2]).toEqual(["models"]);
    expect(models.map((model) => model.id)).toEqual(["kilo/kilo-auto/free", "kilo/openai/gpt-latest"]);
  });

  it("passes provider to kilo models when provided", async () => {
    runChildProcess.mockResolvedValue({ exitCode: 0, signal: null, timedOut: false, stdout: "kilo/openai/gpt-latest\n", stderr: "", pid: 1, startedAt: "now" });
    await discoverKilocodeModels({ command: "kilo", provider: "openai", cwd: process.cwd() });
    expect(runChildProcess.mock.calls[0][2]).toEqual(["models", "openai"]);
  });
});