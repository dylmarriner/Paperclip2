/**
 * SettingsPage - settingsPage slot
 *
 * Plugin configuration page for GitHub Sync.
 */
import { usePluginData, type PluginSettingsPageProps } from "@paperclipai/plugin-sdk/ui";

type ConfigData = {
  syncMode: string;
  appId: number | null;
  installationId: number | null;
  privateKeySecretRef: string | null;
  webhookSecretRef: string;
  patSecretRef: string | null;
};

export function SettingsPage({ context }: PluginSettingsPageProps) {
  const { companyId } = context;
  const config = usePluginData<ConfigData>("config", companyId ? { companyId } : {});

  if (!config.data) {
    return <div style={{ padding: "14px", opacity: 0.7 }}>Loading configuration…</div>;
  }

  return (
    <div style={{ padding: "14px" }}>
      <h3 style={{ marginTop: 0, marginBottom: "12px" }}>GitHub Sync Configuration</h3>
      <div style={{ display: "grid", gap: "10px" }}>
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "12px",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: "8px" }}>Sync Mode</div>
          <div style={{ fontSize: "12px", opacity: 0.7 }}>{config.data.syncMode}</div>
        </div>

        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "12px",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: "8px" }}>GitHub App</div>
          <div style={{ fontSize: "12px", opacity: 0.7 }}>
            {config.data.appId ? `App ID: ${config.data.appId}` : "Not configured"}
          </div>
          <div style={{ fontSize: "12px", opacity: 0.7 }}>
            {config.data.installationId ? `Installation ID: ${config.data.installationId}` : "Not configured"}
          </div>
        </div>

        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "12px",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: "8px" }}>Secret References</div>
          <div style={{ fontSize: "12px", opacity: 0.7 }}>
            Private Key: {config.data.privateKeySecretRef || "Not configured"}
          </div>
          <div style={{ fontSize: "12px", opacity: 0.7 }}>
            Webhook Secret: {config.data.webhookSecretRef || "Not configured"}
          </div>
          <div style={{ fontSize: "12px", opacity: 0.7 }}>
            PAT: {config.data.patSecretRef || "Not configured"}
          </div>
        </div>
      </div>
    </div>
  );
}
