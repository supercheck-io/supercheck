/**
 * Every CHECK on an enum-like column must list exactly the values of the TypeScript constant that defines the
 * union (and feeds the API-boundary z.enum), so adding a value in one place without the other fails here.
 */
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { PgDialect } from "drizzle-orm/pg-core";
import { incidents, statusPageComponents } from "./schema/statusPage";
import { monitors } from "./schema/monitor";
import { notificationProviders } from "./schema/notification";
import { sreServices } from "./schema/sre";
import { tests } from "./schema/test";
import {
  COMPONENT_STATUS_VALUES,
  INCIDENT_IMPACT_VALUES,
  INCIDENT_STATUS_VALUES,
  MONITOR_STATUS_VALUES,
  MONITOR_TYPE_VALUES,
  NOTIFICATION_PROVIDER_TYPE_VALUES,
  TEST_PRIORITY_VALUES,
  TEST_TYPE_VALUES,
} from "./schema/types";
import { SRE_TIER_VALUES } from "./schema/sre";

const dialect = new PgDialect();
function allowedValues(table: PgTable, name: string): string[] {
  const check = getTableConfig(table).checks.find((c) => c.name === name);
  if (!check) throw new Error(`missing check ${name}`);
  const { sql: text } = dialect.sqlToQuery(check.value);
  const list = /\bIN \((.*)\)\s*$/.exec(text)?.[1] ?? "";
  return [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

describe("check() value lists match the TypeScript constants", () => {
  it.each([
    [tests, "tests_type_check", TEST_TYPE_VALUES],
    [tests, "tests_priority_check", TEST_PRIORITY_VALUES],
    [monitors, "monitors_type_check", MONITOR_TYPE_VALUES],
    [monitors, "monitors_status_check", MONITOR_STATUS_VALUES],
    [notificationProviders, "notification_providers_type_check", NOTIFICATION_PROVIDER_TYPE_VALUES],
    [incidents, "incidents_status_check", INCIDENT_STATUS_VALUES],
    [incidents, "incidents_impact_check", INCIDENT_IMPACT_VALUES],
    [statusPageComponents, "status_page_components_status_check", COMPONENT_STATUS_VALUES],
    [sreServices, "sre_services_tier_check", SRE_TIER_VALUES],
  ] as Array<[PgTable, string, readonly string[]]>)("%#: %s", (table, name, values) => {
    expect(allowedValues(table, name)).toEqual([...values]);
  });
});
