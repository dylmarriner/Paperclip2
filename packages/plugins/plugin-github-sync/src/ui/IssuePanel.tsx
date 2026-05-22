/**
 * IssuePanel - detailTab entityTypes=["issue"]
 *
 * Shows GitHub issue links for a Paperclip ticket.
 */
import { usePluginData, usePluginAction, type PluginDetailTabProps } from "@paperclipai/plugin-sdk/ui";

type IssueLink = {
  id: string;
  ghIssueId: number;
  ghIssueNumber: number;
  repoOwner: string;
  repoName: string;
  linkedAt: string;
};

export function IssuePanel({ context }: PluginDetailTabProps) {
  const { companyId, entityId: issueId } = context;
  const issueLinks = usePluginData<IssueLink[]>("issue-links", issueId ? { issueId } : {});
  const linkIssueToTicket = usePluginAction("linkIssueToTicket");
  const createIssueFromTicket = usePluginAction("createIssueFromTicket");

  if (!issueId) {
    return <div style={{ padding: "14px", opacity: 0.7 }}>Select an issue to view GitHub links.</div>;
  }

  if (!issueLinks.data || issueLinks.data.length === 0) {
    return (
      <div style={{ padding: "14px", opacity: 0.7 }}>
        No GitHub issues linked to this ticket.
      </div>
    );
  }

  return (
    <div style={{ padding: "14px" }}>
      <h3 style={{ marginTop: 0, marginBottom: "12px" }}>GitHub Issues</h3>
      <div style={{ display: "grid", gap: "10px" }}>
        {issueLinks.data.map((link) => (
          <div
            key={link.id}
            style={{
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "12px",
            }}
          >
            <div style={{ fontWeight: 600 }}>
              {link.repoOwner}/{link.repoName} #{link.ghIssueNumber}
            </div>
            <div style={{ fontSize: "12px", opacity: 0.7 }}>
              Linked {new Date(link.linkedAt).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
