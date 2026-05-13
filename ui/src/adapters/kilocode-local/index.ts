import type { UIAdapterModule } from "../types";
import { parseKilocodeStdoutLine, buildKilocodeLocalConfig } from "@paperclipai/adapter-kilocode-local/ui";
import { SchemaConfigFields } from "../schema-config-fields";

export const kilocodeLocalUIAdapter: UIAdapterModule = {
  type: "kilocode_local",
  label: "Kilo Code (local)",
  parseStdoutLine: parseKilocodeStdoutLine,
  ConfigFields: SchemaConfigFields,
  buildAdapterConfig: buildKilocodeLocalConfig,
};