import { describe, expect, it } from "vitest";
import { normalizeAcpUpdate } from "./acp.js";

describe("kiro ACP helpers", () => {
  it("normalizes AgentMessageChunk notifications", () => {
    expect(normalizeAcpUpdate({ update: { type: "AgentMessageChunk", content: "hello" } })).toEqual({
      type: "AgentMessageChunk",
      text: "hello",
    });
    expect(normalizeAcpUpdate({ type: "AgentMessageChunk", text: "world" })).toEqual({
      type: "AgentMessageChunk",
      text: "world",
    });
  });

  it("normalizes TurnEnd notifications", () => {
    expect(normalizeAcpUpdate({ update: { type: "TurnEnd" } })).toEqual({ type: "TurnEnd", text: "" });
  });
});