import { describeCron } from "./describe-cron";

it.each([
  ["* * * * *", "Every minute"],
  ["*/15 * * * *", "Every 15 minutes"],
  ["0 * * * *", "Hourly"],
  ["0 */4 * * *", "Every 4 hours"],
  ["0 */1 * * *", "Every hour"],
  ["0 */6 * * *", "Every 6 hours"],
  // Steps that don't divide the range are not uniform intervals, so the raw cron is shown.
  ["*/7 * * * *", "*/7 * * * *"],
  ["*/90 * * * *", "*/90 * * * *"],
  ["0 */5 * * *", "0 */5 * * *"],
  ["30 9 * * *", "Daily at 09:30"],
  ["0 8 * * 1", "Mondays at 08:00"],
  ["0 8 * * 7", "Sundays at 08:00"],
  ["0 8 1 * *", "0 8 1 * *"],
  ["*/0 * * * *", "*/0 * * * *"],
  ["bad", "bad"],
])("describes %s", (cron, text) => expect(describeCron(cron)).toBe(text));
