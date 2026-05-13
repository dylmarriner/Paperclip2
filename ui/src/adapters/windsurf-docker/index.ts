import type { UIAdapterModule } from "../types";
import { buildWindsurfDockerConfig } from "@paperclipai/adapter-windsurf-docker/ui";
import { SchemaConfigFields } from "../schema-config-fields";

export const windsurfDockerUIAdapter: UIAdapterModule = {
  type: "windsurf_docker",
  label: "Windsurf (Docker)",
  parseStdoutLine: (line, ts) => (line.trim() ? [{ kind: "stdout", ts, text: line }] : []),
  ConfigFields: SchemaConfigFields,
  buildAdapterConfig: (values) => buildWindsurfDockerConfig(values.adapterSchemaValues ?? {}) as unknown as Record<string, unknown>,
};