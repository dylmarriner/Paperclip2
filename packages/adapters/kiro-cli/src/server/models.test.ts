import { describe, expect, it, vi, beforeEach } from "vitest";
import { discoverKiroModels, parseKiroModelsOutput, resetKiroModelsCacheForTests } from "./models.js";

const { runChildProcess } = vi.hoisted(() => ({ runChildProcess: vi.fn() }));

vi.mock("@paperclipai/adapter-utils/server-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@paperclipai/adapter-utils/server-utils")>();
  return { ...actual, runChildProcess };
});

describe("kiro model discovery", () => {
  beforeEach(() => {
    runChildProcess.mockReset();
    resetKiroModelsCacheForTests();
  });

  it("parses kiro json model output", () => {
    const output = JSON.stringify({
      models: [
        { model_name: "auto", model_id: "auto", description: "Models chosen by task" },
        { model_name: "claude-sonnet-4.5", model_id: "claude-sonnet-4.5", description: "The Claude Sonnet 4.5 model" },
      ],
    });
    expect(parseKiroModelsOutput(output)).toEqual([
      { id: "auto", label: "auto — Models chosen by task" },
      { id: "claude-sonnet-4.5", label: "claude-sonnet-4.5 — The Claude Sonnet 4.5 model" },
    ]);
  });

  it("runs kiro list models command and parses stdout", async () => {
    runChildProcess.mockResolvedValue({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: JSON.stringify({ models: [{ model_name: "auto", model_id: "auto" }] }),
      stderr: "",
      pid: 1,
      startedAt: "now",
    });
    const models = await discoverKiroModels({ command: "kiro-cli", cwd: process.cwd() });
    expect(runChildProcess.mock.calls[0][2]).toEqual(["chat", "--list-models", "--format", "json"]);
    expect(models).toEqual([{ id: "auto", label: "auto" }]);
  });
});