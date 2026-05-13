import type { CreateConfigValues, TranscriptEntry } from "@paperclipai/adapter-utils";

export function parseKilocodeStdoutLine(line: string, ts: string): TranscriptEntry[] {
  if (!line.trim()) return [];
  return [{ kind: "stdout", ts, text: line }];
}

export function buildKilocodeLocalConfig(values: CreateConfigValues): Record<string, unknown> {
  return { ...(values.adapterSchemaValues ?? {}) };
}