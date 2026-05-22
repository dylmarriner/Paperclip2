import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateStopConditions, evaluateAndStopSequence, buildStopConditionCheck } from "../services/sequence-stop-conditions.js";

function createDbStub() {
  const limit = vi.fn();

  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return { db: { select } as any, select, from, where, limit };
}

function makeCheck(overrides: Partial<{
  runId: string;
  agentId: string;
  companyId: string;
  startedAt: Date;
  timeoutMs: number | null;
}> = {}) {
  return buildStopConditionCheck({
    runId: "run-1",
    agentId: "agent-1",
    companyId: "company-1",
    startedAt: new Date(),
    timeoutMs: null,
    ...overrides,
  });
}

describe("evaluateStopConditions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stops when run no longer exists", async () => {
    const { db, limit } = createDbStub();
    limit.mockResolvedValue([]);

    const result = await evaluateStopConditions(db, makeCheck());

    expect(result.shouldStop).toBe(true);
    if (result.shouldStop) {
      expect(result.reason).toBe("run_cancelled");
      expect(result.detail).toBe("Run no longer exists");
    }
  });

  it("stops when run status is cancelled", async () => {
    const { db, limit } = createDbStub();
    limit.mockResolvedValue([{ status: "cancelled", startedAt: new Date() }]);

    const result = await evaluateStopConditions(db, makeCheck());

    expect(result.shouldStop).toBe(true);
    if (result.shouldStop) {
      expect(result.reason).toBe("run_cancelled");
    }
  });

  it("stops when run has timed out", async () => {
    const { db, limit } = createDbStub();
    const startedAt = new Date(Date.now() - 120_000);
    limit.mockResolvedValue([{ status: "running", startedAt }]);

    const check = makeCheck({ startedAt, timeoutMs: 60_000 });
    const result = await evaluateStopConditions(db, check);

    expect(result.shouldStop).toBe(true);
    if (result.shouldStop) {
      expect(result.reason).toBe("run_timed_out");
    }
  });

  it("allows continuation when conditions are normal", async () => {
    const { db, limit } = createDbStub();
    limit
      .mockResolvedValueOnce([{ status: "running", startedAt: new Date() }])
      .mockResolvedValueOnce([]);

    const result = await evaluateStopConditions(db, makeCheck());

    expect(result.shouldStop).toBe(false);
  });
});

describe("evaluateAndStopSequence", () => {
  it("calls cancelRun when stop condition is met", async () => {
    const { db, limit } = createDbStub();
    limit.mockResolvedValue([]);

    const cancelRun = vi.fn(async () => undefined);
    const result = await evaluateAndStopSequence(db, makeCheck(), cancelRun);

    expect(result).toBe(true);
    expect(cancelRun).toHaveBeenCalledOnce();
    expect(cancelRun).toHaveBeenCalledWith("run-1", expect.stringContaining("run_cancelled"));
  });

  it("does not call cancelRun when no stop condition", async () => {
    const { db, limit } = createDbStub();
    limit
      .mockResolvedValueOnce([{ status: "running", startedAt: new Date() }])
      .mockResolvedValueOnce([]);

    const cancelRun = vi.fn(async () => undefined);
    const result = await evaluateAndStopSequence(db, makeCheck(), cancelRun);

    expect(result).toBe(false);
    expect(cancelRun).not.toHaveBeenCalled();
  });
});
