import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { heartbeatRuns, budgetIncidents } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

export const STOP_REASONS = {
  BUDGET_HARD_STOP: "budget_hard_stop",
  RUN_CANCELLED: "run_cancelled",
  RUN_TIMED_OUT: "run_timed_out",
} as const;

export type StopReason = (typeof STOP_REASONS)[keyof typeof STOP_REASONS];

export type StopConditionCheck = {
  runId: string;
  agentId: string;
  companyId: string;
  startedAt: Date;
  timeoutMs: number | null;
};

export type StopConditionResult =
  | { shouldStop: true; reason: StopReason; detail: string }
  | { shouldStop: false };

const CANCELLED_OR_TIMED_OUT_STATUSES = ["cancelled", "timed_out"];

export async function evaluateStopConditions(
  db: Db,
  check: StopConditionCheck,
): Promise<StopConditionResult> {
  const run = await db
    .select({ status: heartbeatRuns.status, startedAt: heartbeatRuns.startedAt })
    .from(heartbeatRuns)
    .where(eq(heartbeatRuns.id, check.runId))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!run) {
    return { shouldStop: true, reason: "run_cancelled", detail: "Run no longer exists" };
  }

  if (CANCELLED_OR_TIMED_OUT_STATUSES.includes(run.status)) {
    return { shouldStop: true, reason: "run_cancelled", detail: `Run status is ${run.status}` };
  }

  if (check.timeoutMs != null && check.timeoutMs > 0) {
    const elapsed = Date.now() - check.startedAt.getTime();
    if (elapsed > check.timeoutMs) {
      return { shouldStop: true, reason: "run_timed_out", detail: `Run exceeded ${check.timeoutMs}ms timeout` };
    }
  }

  const incident = await db
    .select({ id: budgetIncidents.id })
    .from(budgetIncidents)
    .where(
      and(
        eq(budgetIncidents.companyId, check.companyId),
        eq(budgetIncidents.status, "open"),
      ),
    )
    .limit(1)
    .then((r) => r[0] ?? null);

  if (incident) {
    return { shouldStop: true, reason: "budget_hard_stop", detail: "Open budget incident found for company" };
  }

  return { shouldStop: false };
}

export async function evaluateAndStopSequence(
  db: Db,
  check: StopConditionCheck,
  cancelRun: (runId: string, reason: string) => Promise<unknown>,
): Promise<boolean> {
  const result = await evaluateStopConditions(db, check);
  if (!result.shouldStop) return false;

  logger.warn(
    { runId: check.runId, reason: result.reason, detail: result.detail },
    "Stop condition met, cancelling sequence run",
  );

  try {
    await cancelRun(check.runId, `Stop condition: ${result.reason} — ${result.detail}`);
  } catch (err) {
    logger.error({ err, runId: check.runId }, "Failed to cancel sequence run after stop condition met");
  }

  return true;
}

export function buildStopConditionCheck(input: {
  runId: string;
  agentId: string;
  companyId: string;
  startedAt: Date;
  timeoutMs: number | null;
}): StopConditionCheck {
  return {
    runId: input.runId,
    agentId: input.agentId,
    companyId: input.companyId,
    startedAt: input.startedAt,
    timeoutMs: input.timeoutMs,
  };
}
