/** @jest-environment node */

jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    transaction: jest.fn(),
    query: {
      privateAgents: { findFirst: jest.fn() },
      sreIncidents: { findFirst: jest.fn() },
      sreServices: { findFirst: jest.fn(), findMany: jest.fn() },
    },
  },
}));
jest.mock("@/lib/sre/sre-rate-limiter", () => ({
  checkSreConnectorSearchRateLimit: jest.fn(),
}));

jest.mock("@/lib/sre/connectors", () => ({
  ...jest.requireActual("@/lib/sre/connectors"),
  assertEndpointAllowedForExecution: jest.fn(),
  resolveConnectorCredential: jest.fn(),
  createDirectConnector: jest.fn(),
  sanitizeConnectorEvidence: jest.fn(),
}));

jest.mock("@/lib/private-agents/job-router", () => ({
  routeSreConnectorQuery: jest.fn(),
}));
jest.mock("@/lib/sre/private-agent-job-waiter", () => ({
  waitForPrivateAgentConnectorJob: jest.fn(),
}));

import {
  createDirectConnector,
  sanitizeConnectorEvidence,
} from "@/lib/sre/connectors";
import { checkSreConnectorSearchRateLimit } from "@/lib/sre/sre-rate-limiter";
import { sreEvidenceItems } from "@/db/schema";
import { z } from "zod";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  executeIncidentDiagnosticQuery,
  listIncidentDiagnosticQueries,
  createSreConnectorTools,
  listIncidentLiveConnectors,
  searchIncidentLiveConnectorEvidence,
} from "./connector-tools";

const { db } = jest.requireMock("@/utils/db");
const scope = {
  organizationId: "018f0000-0000-7000-8000-000000000001",
  projectId: "018f0000-0000-7000-8000-000000000002",
  incidentId: null,
};
const serviceId = "018f0000-0000-7000-8000-000000000003";
const connectorId = "018f0000-0000-7000-8000-000000000004";
const search = {
  connectorId,
  serviceId,
  query: "up",
  timeWindowMinutes: 60,
  maxRows: 5,
  maxBytes: 1024,
  maxSeconds: 5,
};

function selectRows(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        orderBy: async () => rows,
        then: (resolve: (value: unknown[]) => void) => resolve(rows),
      }),
    }),
  };
}

describe("Copilot connector service scope", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    db.query.sreServices.findMany.mockResolvedValue([
      { id: serviceId, name: "Checkout", environment: "production" },
    ]);
    db.select.mockReturnValue(selectRows([]));
  });

  it("discovers services without requiring an incident and keeps project isolation", async () => {
    const result = await listIncidentLiveConnectors(scope);
    expect(result).toMatchObject({
      primaryServiceId: null,
      services: [{ id: serviceId, name: "Checkout" }],
      connectors: [],
    });
    const query = new PgDialect().sqlToQuery(
      db.query.sreServices.findMany.mock.calls[0][0].where,
    );
    expect(query.params).toEqual(
      expect.arrayContaining([scope.organizationId, scope.projectId, "active"]),
    );
  });

  it("can find a named service beyond the initial bounded list", async () => {
    const connectorTool = createSreConnectorTools(scope).listIncidentConnectors;
    const input = (
      connectorTool.inputSchema as z.ZodType<{ serviceName?: string }>
    ).parse({ serviceName: "Checkout" });
    await connectorTool.execute!(input, {
      toolCallId: "discover",
      messages: [],
    });
    const query = new PgDialect().sqlToQuery(
      db.query.sreServices.findMany.mock.calls[0][0].where,
    );
    expect(query.params).toContain("%Checkout%");
  });

  it("rejects a service outside the project before loading or executing connectors", async () => {
    db.query.sreServices.findFirst.mockResolvedValue(null);
    await expect(
      searchIncidentLiveConnectorEvidence(scope, search),
    ).rejects.toThrow("Service not found or access denied");
    const query = new PgDialect().sqlToQuery(
      db.query.sreServices.findFirst.mock.calls[0][0].where,
    );
    expect(query.params).toEqual(
      expect.arrayContaining([
        scope.organizationId,
        scope.projectId,
        serviceId,
      ]),
    );
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects general live searches without a selected service", async () => {
    await expect(
      searchIncidentLiveConnectorEvidence(scope, {
        ...search,
        serviceId: undefined,
      }),
    ).rejects.toThrow("Select a service");
  });

  it("rejects a connector mapped to a different service", async () => {
    db.query.sreServices.findFirst.mockResolvedValue({ id: serviceId });
    db.select
      .mockReturnValueOnce(selectRows([{ connector: { id: connectorId } }]))
      .mockReturnValueOnce(
        selectRows([{ connectorId, serviceId: "other-service" }]),
      );
    await expect(
      searchIncidentLiveConnectorEvidence(scope, search),
    ).rejects.toThrow("Connector not found");
  });

  it.each([null, "018f0000-0000-7000-8000-000000000099"])(
    "returns general-chat evidence without persistence and still saves incident evidence (%s)",
    async (incidentId) => {
      db.query.sreIncidents.findFirst.mockResolvedValue({
        primaryServiceId: serviceId,
      });
      db.query.sreServices.findFirst.mockResolvedValue({ id: serviceId });
      db.select
        .mockReturnValueOnce(
          selectRows([
            {
              connector: {
                id: connectorId,
                type: "prometheus",
                status: "configured",
                config: { endpointUrl: "https://prometheus.example" },
                permissionLevel: "read",
                sideEffectLevel: "none",
                defaultTimeWindowMinutes: 60,
                outputLimits: { maxRows: 10, maxBytes: 1024, maxSeconds: 15 },
              },
            },
          ]),
        )
        .mockReturnValueOnce(selectRows([{ connectorId, serviceId }]));
      jest
        .mocked(checkSreConnectorSearchRateLimit)
        .mockResolvedValue({ allowed: true, remaining: 10 });
      const execute = jest.fn().mockResolvedValue([]);
      jest.mocked(createDirectConnector).mockImplementation((definition) => ({
        ...definition,
        search: execute,
        validate: jest.fn(),
        metadata: jest.fn(),
      }));
      jest.mocked(sanitizeConnectorEvidence).mockReturnValue({
        items: [
          {
            id: "connector-evidence",
            source: "prometheus",
            sourceUri: "https://prometheus.example",
            title: "Service up",
            summary: "up=1",
            evidenceType: "metric",
            citation: { connectorId, query: "up", resultHash: "hash" },
            metadata: { timestamp: new Date() },
          },
        ],
        truncated: false,
        resultHash: "hash",
      } as ReturnType<typeof sanitizeConnectorEvidence>);
      const values = jest.fn(() => ({
        returning: async () => [{ id: "evidence", title: "Service up" }],
      }));
      db.insert.mockReturnValue({ values });
      const result = await searchIncidentLiveConnectorEvidence(
        { ...scope, incidentId },
        search,
      );
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({ serviceId }),
      );
      if (incidentId) {
        expect(db.insert).toHaveBeenCalledWith(sreEvidenceItems);
        expect(values).toHaveBeenCalledWith([
          expect.objectContaining({ incidentId }),
        ]);
      } else {
        expect(db.insert).not.toHaveBeenCalledWith(sreEvidenceItems);
        expect(values).toHaveBeenCalledWith(
          expect.objectContaining({ evidenceItemId: null }),
        );
      }
      expect(result.persisted).toBe(Boolean(incidentId));
      expect(result.evidence).toEqual([
        expect.objectContaining({
          id: incidentId ? "evidence" : "connector-evidence",
        }),
      ]);
    },
  );

  it("validates the project service before executing a general-chat diagnostic query", async () => {
    db.query.sreServices.findFirst.mockResolvedValue(null);
    await expect(
      executeIncidentDiagnosticQuery(scope, {
        serviceId,
        queryId: connectorId,
        parameters: {},
        timeWindowMinutes: 60,
      }),
    ).rejects.toThrow("Service not found or access denied");
    expect(db.select).not.toHaveBeenCalled();
  });

  it("lists only project connector diagnostic templates for general chat", async () => {
    db.select
      .mockReturnValueOnce(selectRows([{ connector: { id: connectorId } }]))
      .mockReturnValueOnce(selectRows([{ connectorId, serviceId }]))
      .mockReturnValueOnce({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              orderBy: () => ({
                limit: async () => [
                  {
                    id: "query",
                    connectorId,
                    name: "Health",
                    connectorName: "Metrics",
                    connectorType: "prometheus",
                    queryType: "promql",
                    maxRows: 5,
                    maxBytes: 1024,
                    maxSeconds: 5,
                  },
                ],
              }),
            }),
          }),
        }),
      });
    const result = await listIncidentDiagnosticQueries(scope);
    expect(result.queries).toEqual([
      expect.objectContaining({ id: "query", connectorId }),
    ]);
  });

  it.each([null, "018f0000-0000-7000-8000-000000000099"])(
    "keeps Private Agent results temporary only for general chat (%s)",
    async (incidentId) => {
      db.query.sreServices.findFirst.mockResolvedValue({ id: serviceId });
      db.query.sreIncidents.findFirst.mockResolvedValue({
        primaryServiceId: serviceId,
      });
      db.query.privateAgents.findFirst.mockResolvedValue({
        id: "private-agent",
      });
      db.select
        .mockReturnValueOnce(
          selectRows([
            {
              connector: {
                id: connectorId,
                type: "prometheus",
                privateAgentId: "private-agent",
                config: { endpointUrl: "https://prometheus.example" },
                status: "configured",
                permissionLevel: "read",
                sideEffectLevel: "none",
                defaultTimeWindowMinutes: 60,
                outputLimits: { maxRows: 10, maxBytes: 1024, maxSeconds: 15 },
              },
            },
          ]),
        )
        .mockReturnValueOnce(selectRows([{ connectorId, serviceId }]));
      jest
        .mocked(checkSreConnectorSearchRateLimit)
        .mockResolvedValue({ allowed: true, remaining: 10 });
      const { routeSreConnectorQuery } = jest.requireMock(
        "@/lib/private-agents/job-router",
      );
      routeSreConnectorQuery.mockReturnValue({
        routed: true,
        privateAgentId: "private-agent",
        jobClass: "connector-query",
        jobSpec: {},
        jobSpecHash: "hash",
        idempotencyKey: "job-key",
      });
      const { waitForPrivateAgentConnectorJob } = jest.requireMock(
        "@/lib/sre/private-agent-job-waiter",
      );
      waitForPrivateAgentConnectorJob.mockResolvedValue({
        state: "completed",
        job: {
          resultHash: "hash",
          resultSummary: {
            evidence: [
              {
                id: "provider-evidence",
                sourceUri: "https://prometheus.example",
                title: "Health",
                summary: "up=1",
                evidenceType: "metric",
                observedAt: "2026-10-09T00:00:00Z",
                resultHash: "a".repeat(64),
              },
            ],
          },
        },
      });
      const values = jest.fn(() => ({
        onConflictDoNothing: () => ({ returning: async () => [{ id: "job" }] }),
      }));
      db.insert.mockReturnValue({ values });
      const evidenceValues = jest.fn(() => ({
        returning: async () => [{ id: "saved-evidence", title: "Health" }],
      }));
      db.transaction.mockImplementation(
        async (callback: (tx: unknown) => unknown) =>
          callback({
            select: () => ({
              from: () => ({ where: () => ({ limit: async () => [] }) }),
            }),
            insert: () => ({ values: evidenceValues }),
          }),
      );
      const result = await searchIncidentLiveConnectorEvidence(
        { ...scope, incidentId },
        search,
      );
      expect(result).toMatchObject({
        persisted: Boolean(incidentId),
        executionMode: "private_agent",
        evidence: [{ id: incidentId ? "saved-evidence" : "provider-evidence" }],
      });
      if (incidentId) expect(db.transaction).toHaveBeenCalled();
      else {
        expect(db.transaction).not.toHaveBeenCalled();
        expect(values).toHaveBeenCalledWith(
          expect.objectContaining({ evidenceItemId: null }),
        );
      }
    },
  );

  it("keeps incident chats pinned to their linked service", async () => {
    db.query.sreIncidents.findFirst.mockResolvedValue({
      primaryServiceId: "other-service",
    });
    await expect(
      searchIncidentLiveConnectorEvidence(
        { ...scope, incidentId: "incident" },
        search,
      ),
    ).rejects.toThrow("Service does not match the scoped incident");
    expect(db.query.sreServices.findFirst).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });
});
