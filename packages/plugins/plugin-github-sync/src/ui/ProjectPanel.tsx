/**
 * ProjectPanel - detailTab entityTypes=["project"]
 *
 * Shows GitHub repository links for a Paperclip project.
 */
import { useState } from "react";
import { usePluginData, usePluginAction, type PluginDetailTabProps } from "@paperclipai/plugin-sdk/ui";

type RepoLink = {
  id: string;
  repoOwner: string;
  repoName: string;
  repoId: number;
  defaultBranch: string;
  connectedAt: string;
  lastSyncedAt: string | null;
};

export function ProjectPanel({ context }: PluginDetailTabProps) {
  const { companyId, entityId: projectId } = context;
  const repoLinks = usePluginData<RepoLink[]>("repo-links", projectId ? { projectId } : {});
  const syncRepository = usePluginAction("syncRepository");
  const [syncing, setSyncing] = useState(false);

  async function handleSync(repoLink: RepoLink) {
    setSyncing(true);
    try {
      await syncRepository({
        repoOwner: repoLink.repoOwner,
        repoName: repoLink.repoName,
      });
    } finally {
      setSyncing(false);
    }
  }

  if (!projectId) {
    return <div style={{ padding: "14px", opacity: 0.7 }}>Select a project to view GitHub links.</div>;
  }

  if (!repoLinks.data || repoLinks.data.length === 0) {
    return (
      <div style={{ padding: "14px", opacity: 0.7 }}>
        No GitHub repositories linked to this project.
      </div>
    );
  }

  return (
    <div style={{ padding: "14px" }}>
      <h3 style={{ marginTop: 0, marginBottom: "12px" }}>GitHub Repositories</h3>
      <div style={{ display: "grid", gap: "10px" }}>
        {repoLinks.data.map((link) => (
          <div
            key={link.id}
            style={{
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "12px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{link.repoOwner}/{link.repoName}</div>
              <div style={{ fontSize: "12px", opacity: 0.7 }}>
                {link.defaultBranch} • synced {link.lastSyncedAt ? new Date(link.lastSyncedAt).toLocaleString() : "never"}
              </div>
            </div>
            <button
              type="button"
              disabled={syncing}
              onClick={() => void handleSync(link)}
              style={{
                appearance: "none",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                background: "transparent",
                color: "inherit",
                padding: "6px 12px",
                fontSize: "12px",
                cursor: syncing ? "not-allowed" : "pointer",
                opacity: syncing ? 0.5 : 1,
              }}
            >
              {syncing ? "Syncing..." : "Sync"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
