/** @jest-environment node */

import { sreEvalFixtures } from "./fixtures";
import { assertSreEvalGate, runSreEvalSuite } from "./harness";
import { createSreLiveApiEvalRunner, parseSreLiveEvalEnvironment } from "./live-env";

const liveConfig = parseSreLiveEvalEnvironment();
const describeLiveEval = liveConfig.enabled ? describe : describe.skip;

describeLiveEval("SRE live API eval", () => {
  it("scores seeded live investigation fixtures", async () => {
    const results = await runSreEvalSuite(sreEvalFixtures, createSreLiveApiEvalRunner(liveConfig));

    assertSreEvalGate(results);
  }, 120_000);
});
