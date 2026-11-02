const { validatePendingConstraints } = require("./validate-constraints.js");

function fakeClient({ pending, failing = [] }) {
  const calls = [];
  const client = async () => pending;
  client.begin = async (callback) => {
    const tx = async () => [];
    tx.unsafe = async (statement) => {
      calls.push(statement);
      if (failing.some((name) => statement.includes(name))) throw new Error("violating rows");
    };
    await callback(tx);
  };
  return { client, calls };
}

describe("validatePendingConstraints", () => {
  it("validates each NOT VALID constraint in its own transaction", async () => {
    const { client, calls } = fakeClient({
      pending: [
        { table_name: "tests", constraint_name: "a_check", conname: "a_check" },
        { table_name: '"user"', constraint_name: "b_fkey", conname: "b_fkey" },
      ],
    });
    const result = await validatePendingConstraints(client);
    expect(calls).toEqual([
      "ALTER TABLE tests VALIDATE CONSTRAINT a_check",
      'ALTER TABLE "user" VALIDATE CONSTRAINT b_fkey',
    ]);
    expect(result).toEqual({ validated: ["a_check", "b_fkey"], left: [] });
  });

  it("logs and continues when a constraint cannot be validated", async () => {
    const { client } = fakeClient({
      pending: [
        { table_name: "tests", constraint_name: "bad_check", conname: "bad_check" },
        { table_name: "jobs", constraint_name: "ok_check", conname: "ok_check" },
      ],
      failing: ["bad_check"],
    });
    const logWarning = jest.fn();
    const result = await validatePendingConstraints(client, { logWarning });
    expect(result).toEqual({ validated: ["ok_check"], left: ["bad_check"] });
    expect(logWarning).toHaveBeenCalledWith(expect.stringContaining("bad_check left NOT VALID"));
    expect(logWarning).toHaveBeenLastCalledWith("1 constraint(s) left NOT VALID: bad_check");
  });

  it("logs no summary when everything validated", async () => {
    const { client } = fakeClient({ pending: [{ table_name: "tests", constraint_name: "a", conname: "a" }] });
    const logWarning = jest.fn();
    await validatePendingConstraints(client, { logWarning });
    expect(logWarning).not.toHaveBeenCalled();
  });
});
