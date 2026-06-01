import type { Db } from "@paperclipai/db"
import { logger } from "../middleware/logger.js"
import { nextCronTickFromExpression } from "./cron.js"
import { runLinkCheckerJob } from "./link-checker-job.js"

const DEFAULT_SCHEDULE = "0 0 * * *"

export function scheduleLinkChecker(
  db: Db,
  scheduleExpression: string = DEFAULT_SCHEDULE,
  tickIntervalMs = 60_000,
): { stop: () => void } {
  let stopped = false

  async function tick() {
    if (stopped) return
    const now = new Date()
    const next = nextCronTickFromExpression(scheduleExpression, now)

    if (next && Math.abs(next.getTime() - now.getTime()) < tickIntervalMs) {
      try {
        await runLinkCheckerJob(db)
      } catch (err) {
        logger.error({ err }, "Link checker cron job failed")
      }
    }
  }

  const interval = setInterval(tick, tickIntervalMs)

  return {
    stop: () => {
      stopped = true
      clearInterval(interval)
    },
  }
}
