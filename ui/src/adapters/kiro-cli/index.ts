import type { UIAdapterModule } from "../types";
import { parseKiroStdoutLine, buildKiroCliConfig } from "@paperclipai/adapter-kiro-cli/ui";
import { SchemaConfigFields } from "../schema-config-fields";

export const kiroCliUIAdapter: UIAdapterModule = {
  type: "kiro_cli",
  label: "Kiro CLI",
  parseStdoutLine: parseKiroStdoutLine,
  ConfigFields: SchemaConfigFields,
  buildAdapterConfig: buildKiroCliConfig,
};