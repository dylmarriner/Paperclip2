/**
 * Test helpers for the GitHub Sync plugin.
 */
import crypto from "crypto";
import type { PluginContext, ToolRunContext, PluginLogger } from "@paperclipai/plugin-sdk";

let testKeyPair: { publicKey: string; privateKey: string } | null = null;

/** Generate (or reuse) an RSA key pair for JWT signing tests. */
export function getTestKeyPair(): { publicKey: string; privateKey: string } {
  if (!testKeyPair) {
    const pair = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    testKeyPair = { publicKey: pair.publicKey, privateKey: pair.privateKey };
  }
  return testKeyPair;
}

/** Create a mock fetch that returns a JSON body with the given status. */
export function mockFetchJson(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: headers ?? {},
    });
}

/** Create a mock auth provider that returns a fixed Authorization header. */
export function mockAuthProvider(token: string) {
  return {
    async getAuthHeaders(): Promise<Record<string, string>> {
      return { Authorization: `Bearer ${token}` };
    },
  };
}

const defaultRepoLinkId = "repo-link-test-uuid";

/** Create a mock PluginContext for testing tools and webhook handlers. */
export function mockPluginContext(opts: {
  executeResult?: { rowCount: number };
  queryResult?: unknown[];
  executeFn?: (sql: string, params?: unknown[]) => Promise<{ rowCount: number }>;
  queryFn?: (sql: string, params?: unknown[]) => Promise<unknown[]>;
} = {}): PluginContext {
  const logger: PluginLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
  return {
    db: {
      namespace: "plugin_github_sync_60491d4d6b",
      execute: opts.executeFn ?? (async () => opts.executeResult ?? { rowCount: 1 }),
      query:
        opts.queryFn ??
        (async () =>
          (opts.queryResult ?? [{ id: defaultRepoLinkId }]) as unknown[]),
    },
    logger,
    config: { get: async () => ({}) },
    secrets: { resolve: async () => "" },
    http: { fetch: async () => new Response() },
    tools: { register: () => {} },
    activity: { log: async () => {} },
    state: { get: async () => null, set: async () => {} },
    events: { on: () => {}, emit: async () => {} },
    jobs: { register: () => {} },
    entities: { upsert: async () => {}, query: async () => [] },
    manifest: {} as PluginContext["manifest"],
    localFolders: {} as PluginContext["localFolders"],
    launchers: {} as PluginContext["launchers"],
    projects: {} as PluginContext["projects"],
    routines: {} as PluginContext["routines"],
    skills: {} as PluginContext["skills"],
    companies: {} as PluginContext["companies"],
    issues: {} as PluginContext["issues"],
    agents: {} as PluginContext["agents"],
    goals: {} as PluginContext["goals"],
    data: {} as PluginContext["data"],
    actions: {} as PluginContext["actions"],
    streams: {} as PluginContext["streams"],
    metrics: {} as PluginContext["metrics"],
    telemetry: {} as PluginContext["telemetry"],
  } as unknown as PluginContext;
}

/** Create a mock ToolRunContext. */
export function mockToolRunContext(overrides?: Partial<ToolRunContext>): ToolRunContext {
  return {
    agentId: "agent-1",
    runId: "run-1",
    companyId: "company-1",
    projectId: "project-1",
    ...overrides,
  };
}
