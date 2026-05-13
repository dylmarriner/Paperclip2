import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";

export interface JsonRpcRequest { jsonrpc: "2.0"; id: number; method: string; params?: unknown }
export interface JsonRpcResponse { jsonrpc: "2.0"; id?: number; result?: unknown; error?: { code: number; message: string; data?: unknown }; method?: string; params?: unknown }

export interface KiroAcpOptions {
  executable: string;
  cwd: string;
  env: Record<string, string>;
  agent?: string;
  model?: string;
  sessionId?: string;
  prompt: string;
  timeoutSec: number;
  onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
}

export async function runKiroAcp(options: KiroAcpOptions): Promise<{ exitCode: number | null; signal: string | null; text: string; sessionId: string | null; timedOut: boolean }> {
  const args = ["acp", ...(options.agent ? ["--agent", options.agent] : [])];
  const child = spawn(options.executable, args, {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  }) as ChildProcessWithoutNullStreams;

  let nextId = 1;
  let buffer = "";
  let text = "";
  let sessionId = options.sessionId ?? null;
  const pending = new Map<number, { resolve: (value: JsonRpcResponse) => void; reject: (error: Error) => void }>();
  let turnEnded = false;
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }, options.timeoutSec * 1000);

  child.stderr.on("data", (chunk: Buffer) => void options.onLog("stderr", chunk.toString("utf8")));
  child.stdout.on("data", (chunk: Buffer) => {
    const raw = chunk.toString("utf8");
    buffer += raw;
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      void options.onLog("stdout", `${line}\n`);
      let message: JsonRpcResponse;
      try {
        message = JSON.parse(line) as JsonRpcResponse;
      } catch {
        continue;
      }
      if (typeof message.id === "number" && pending.has(message.id)) {
        pending.get(message.id)!.resolve(message);
        pending.delete(message.id);
        continue;
      }
      if (message.method === "session/notification") {
        const update = normalizeAcpUpdate(message.params);
        if (update.type === "AgentMessageChunk") text += update.text;
        if (update.type === "TurnEnd") turnEnded = true;
      }
    }
  });

  function request(method: string, params?: unknown): Promise<JsonRpcResponse> {
    const id = nextId++;
    const payload: JsonRpcRequest = { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };
    child.stdin.write(`${JSON.stringify(payload)}\n`, "utf8");
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }

  try {
    const init = await request("initialize", { protocolVersion: "0.3.0", clientCapabilities: {} });
    if (init.error) throw new Error(`Kiro ACP initialize failed: ${init.error.message}`);

    if (sessionId) {
      const loaded = await request("session/load", { sessionId });
      if (loaded.error) throw new Error(`Kiro ACP session/load failed: ${loaded.error.message}`);
    } else {
      const created = await request("session/new", {});
      if (created.error) throw new Error(`Kiro ACP session/new failed: ${created.error.message}`);
      const result = created.result as { sessionId?: string } | undefined;
      sessionId = result?.sessionId ?? null;
    }

    if (options.model) {
      const model = await request("session/set_model", { sessionId, model: options.model });
      if (model.error) throw new Error(`Kiro ACP session/set_model failed: ${model.error.message}`);
    }

    const prompted = await request("session/prompt", { sessionId, prompt: [{ type: "text", text: options.prompt }] });
    if (prompted.error) throw new Error(`Kiro ACP session/prompt failed: ${prompted.error.message}`);

    while (!turnEnded && !timedOut && child.exitCode === null) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    child.stdin.end();
    const [exitCode, signal] = await once(child, "close") as [number | null, NodeJS.Signals | null];
    return { exitCode, signal, text, sessionId, timedOut };
  } finally {
    clearTimeout(timeout);
    for (const pendingCall of pending.values()) pendingCall.reject(new Error("Kiro ACP process closed before response."));
    pending.clear();
  }
}

export function normalizeAcpUpdate(params: unknown): { type: string; text: string } {
  const value = typeof params === "object" && params !== null ? params as Record<string, unknown> : {};
  const update = typeof value.update === "object" && value.update !== null ? value.update as Record<string, unknown> : value;
  const type = typeof update.type === "string" ? update.type : "";
  const text = typeof update.content === "string" ? update.content : typeof update.text === "string" ? update.text : "";
  return { type, text };
}