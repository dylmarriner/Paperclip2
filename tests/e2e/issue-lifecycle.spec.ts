import { test, expect } from "@playwright/test";

/**
 * E2E: Issue lifecycle via API (skip_llm mode).
 *
 * Covers the full issue lifecycle outside of the onboarding flow:
 *   1. Create a company with an agent
 *   2. Create issues with different priorities and statuses
 *   3. Edit issue title, description, priority
 *   4. Transition through statuses (todo → in_progress → done)
 *   5. Verify issue list filtering
 *   6. Delete an issue
 */

const PORT = Number(process.env.PAPERCLIP_E2E_PORT ?? 3199);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const COMPANY_NAME = `E2E-IssueLifecycle-${Date.now()}`;

test.describe("Issue lifecycle", () => {
  let boardRequest: Awaited<ReturnType<typeof import("@playwright/test").request["newContext"]>>;
  let companyId: string;
  let companyPrefix: string;
  let agentId: string;

  test.beforeAll(async () => {
    const { request: pwRequest } = await import("@playwright/test");
    boardRequest = await pwRequest.newContext({ baseURL: BASE_URL });

    const healthRes = await boardRequest.get(`${BASE_URL}/api/health`);
    expect(healthRes.ok()).toBe(true);

    const companyRes = await boardRequest.post(`${BASE_URL}/api/companies`, {
      data: { name: COMPANY_NAME },
    });
    expect(companyRes.ok()).toBe(true);
    const company = await companyRes.json();
    companyId = company.id;
    companyPrefix = company.issuePrefix ?? company.id;

    const agentRes = await boardRequest.post(`${BASE_URL}/api/companies/${companyId}/agents`, {
      data: {
        name: "Engineer",
        role: "engineer",
        title: "Software Engineer",
        adapterType: "process",
        adapterConfig: {
          command: process.execPath,
          args: ["-e", "process.stdout.write('done\\n')"],
        },
      },
    });
    expect(agentRes.ok()).toBe(true);
    const agent = await agentRes.json();
    agentId = agent.id;
  });

  test.afterAll(async () => {
    if (boardRequest) {
      await boardRequest.delete(`${BASE_URL}/api/companies/${companyId}`).catch(() => {});
      await boardRequest.dispose();
    }
  });

  test("creates issues with different priorities", async () => {
    const priorities = ["low", "medium", "high", "critical"] as const;
    const createdIds: string[] = [];

    for (const priority of priorities) {
      const res = await boardRequest.post(`${BASE_URL}/api/companies/${companyId}/issues`, {
        data: {
          title: `Issue with ${priority} priority`,
          description: `Description for ${priority} priority issue`,
          status: "backlog",
          priority,
          assigneeAgentId: agentId,
        },
      });
      expect(res.ok()).toBe(true);
      const issue = await res.json();
      expect(issue.title).toBe(`Issue with ${priority} priority`);
      expect(issue.priority).toBe(priority);
      expect(issue.status).toBe("backlog");
      expect(issue.assigneeAgentId).toBe(agentId);
      createdIds.push(issue.id);
    }

    expect(createdIds).toHaveLength(priorities.length);
  });

  test("edits issue title, description, and priority", async () => {
    const createRes = await boardRequest.post(`${BASE_URL}/api/companies/${companyId}/issues`, {
      data: {
        title: "Original title",
        description: "Original description",
        status: "backlog",
        priority: "medium",
      },
    });
    expect(createRes.ok()).toBe(true);
    const issue = await createRes.json();

    const editRes = await boardRequest.patch(`${BASE_URL}/api/issues/${issue.id}`, {
      data: {
        title: "Updated title",
        description: "Updated description",
        priority: "high",
      },
    });
    expect(editRes.ok()).toBe(true);
    const updated = await editRes.json();

    expect(updated.title).toBe("Updated title");
    expect(updated.description).toBe("Updated description");
    expect(updated.priority).toBe("high");
  });

  test("transitions issue through statuses", async () => {
    const createRes = await boardRequest.post(`${BASE_URL}/api/companies/${companyId}/issues`, {
      data: {
        title: "Status transition test",
        description: "Testing status transitions",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
      },
    });
    expect(createRes.ok()).toBe(true);
    const issue = await createRes.json();
    expect(issue.status).toBe("todo");

    const startRes = await boardRequest.patch(`${BASE_URL}/api/issues/${issue.id}`, {
      data: { status: "in_progress" },
    });
    expect(startRes.ok()).toBe(true);
    expect((await startRes.json()).status).toBe("in_progress");

    const doneRes = await boardRequest.patch(`${BASE_URL}/api/issues/${issue.id}`, {
      data: { status: "done" },
    });
    expect(doneRes.ok()).toBe(true);
    expect((await doneRes.json()).status).toBe("done");
  });

  test("lists issues with status filter", async () => {
    const listRes = await boardRequest.get(
      `${BASE_URL}/api/companies/${companyId}/issues?status=backlog`,
    );
    expect(listRes.ok()).toBe(true);
    const issues = await listRes.json();
    expect(Array.isArray(issues)).toBe(true);

    for (const issue of issues) {
      expect(issue.status).toBe("backlog");
    }
  });

  test("deletes an issue", async () => {
    const createRes = await boardRequest.post(`${BASE_URL}/api/companies/${companyId}/issues`, {
      data: {
        title: "Issue to delete",
        status: "backlog",
        priority: "low",
      },
    });
    expect(createRes.ok()).toBe(true);
    const issue = await createRes.json();

    const deleteRes = await boardRequest.delete(`${BASE_URL}/api/issues/${issue.id}`);
    expect(deleteRes.ok()).toBe(true);

    const getRes = await boardRequest.get(`${BASE_URL}/api/issues/${issue.id}`);
    expect(getRes.status()).toBe(404);
  });

  test("shows issue list on the issues page", async ({ page }) => {
    await page.goto(`/${companyPrefix}/issues`);
    await expect(page).toHaveURL(/\/issues/);
    await expect(page.getByText("Issue with low priority")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Issue with medium priority")).toBeVisible();
    await expect(page.getByText("Issue with high priority")).toBeVisible();
    await expect(page.getByText("Issue with critical priority")).toBeVisible();
  });
});
