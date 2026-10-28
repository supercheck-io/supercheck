import { validateJobCron } from "./job-cron-validation";

describe("validateJobCron (c10)", () => {
  it.each(["* * * * * *", "*/5 * * * * *", "* * * *", "not a cron", "@hourly", "61 * * * *", "* * * * * * *", "H * * * *", "H/5 * * * *", 42, {}])("rejects %j", (cron: unknown) => {
    expect(validateJobCron(cron)).toEqual(expect.any(String));
  });
  it.each(["* * * * *", "*/5 * * * *", "0 * * * *", "0 9 * * 1-5", "0,1 * * * *"])("accepts %j", (cron) => {
    expect(validateJobCron(cron)).toBeNull();
  });
  it("treats an empty schedule as unscheduled", () => {
    expect(validateJobCron("")).toBeNull();
    expect(validateJobCron(undefined)).toBeNull();
  });
});
