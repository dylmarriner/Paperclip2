/**
 * UI entrypoint for the GitHub Sync plugin.
 *
 * Exports components for:
 *   - ProjectPanel (detailTab entityTypes=["project"])
 *   - IssuePanel (detailTab entityTypes=["issue"])
 *   - SettingsPage (settingsPage slot)
 */
import { ProjectPanel } from "./ProjectPanel.js";
import { IssuePanel } from "./IssuePanel.js";
import { SettingsPage } from "./SettingsPage.js";

export { ProjectPanel, IssuePanel, SettingsPage };
