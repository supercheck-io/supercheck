import type { AnchorHTMLAttributes, ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  createSreInvestigationReportSnapshot,
  saveSreInvestigationReportFeedback,
} from "@/actions/sre-investigation-reports";
import type { SreInvestigationHistoryItem } from "@/lib/sre/investigation-queries";

import { SreInvestigationsTable } from "./investigations-table";

type MockLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  children: ReactNode;
};

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: MockLinkProps) => <a href={href} {...props}>{children}</a>,
}));

jest.mock("@/actions/sre-investigation-reports", () => ({
  createSreInvestigationReportSnapshot: jest.fn(),
  saveSreInvestigationReportFeedback: jest.fn(),
}));

const mockCreateSreInvestigationReportSnapshot = createSreInvestigationReportSnapshot as jest.Mock;
const mockSaveSreInvestigationReportFeedback = saveSreInvestigationReportFeedback as jest.Mock;

function readBlobText(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

const investigations: SreInvestigationHistoryItem[] = [
  {
    id: "018f0000-0000-7000-8000-000000000001",
    incidentId: "018f0000-0000-7000-8000-000000000002",
    incidentNumber: 42,
    incidentTitle: "Checkout latency",
    serviceName: "checkout-api",
    severity: "sev2",
    incidentStatus: "investigating",
    agentType: "investigation",
    status: "completed",
    modelId: "test-model",
    rootCauseHypothesis: "Database pool saturation is likely.",
    confidenceScore: "0.8000",
    evidenceCount: 3,
    toolCallCount: 2,
    recommendationCount: 1,
    estimatedCostCents: 50,
    durationMs: 12500,
    createdAt: new Date("2026-06-24T12:00:00Z"),
    completedAt: new Date("2026-06-24T12:00:12Z"),
    reportSnapshotId: null,
    reportSnapshotCreatedAt: null,
    reportFeedbackAccuracy: null,
    reportFeedbackUpdatedAt: null,
    reportRejectedHypothesisCount: 0,
    reportExport: {
      version: "sre-investigation-report.v1",
      exportedAt: "2026-06-24T12:01:00.000Z",
      run: {
        id: "018f0000-0000-7000-8000-000000000001",
        agentType: "investigation",
        status: "completed",
        modelId: "test-model",
        confidenceScore: "0.8000",
        rootCauseHypothesis: "Database pool saturation is likely.",
        durationMs: 12500,
        estimatedCostCents: 50,
        createdAt: "2026-06-24T12:00:00.000Z",
        completedAt: "2026-06-24T12:00:12.000Z",
      },
      incident: {
        id: "018f0000-0000-7000-8000-000000000002",
        number: 42,
        title: "Checkout latency",
        severity: "sev2",
        status: "investigating",
      },
      service: { name: "checkout-api" },
      evidence: [
        {
          id: "ev-checkout-5xx",
          title: "Checkout 5xx spike",
          summary: "Prometheus 5xx rate stayed above threshold.",
          sourceType: "prometheus",
          evidenceType: "metric",
          severity: "sev2",
          citationResultHash: "hash-evidence",
          observedAt: "2026-06-24T11:59:00.000Z",
          createdAt: "2026-06-24T12:00:02.000Z",
        },
      ],
      toolCalls: [
        {
          id: "tool-call-1",
          connectorType: "prometheus",
          toolName: "prometheus.query_range",
          status: "success",
          inputHash: "hash-input",
          outputHash: "hash-output",
          evidenceItemId: "ev-checkout-5xx",
          durationMs: 320,
          executedAt: "2026-06-24T12:00:01.000Z",
        },
      ],
      recommendations: [],
      provenance: {
        evidenceCount: 1,
        toolCallCount: 1,
        recommendationCount: 0,
        rawFieldsExcluded: ["rawInputS3Path", "rawOutputS3Path", "rawContentExcerpt", "sourceUri"],
      },
    },
  },
  {
    id: "018f0000-0000-7000-8000-000000000003",
    incidentId: "018f0000-0000-7000-8000-000000000004",
    incidentNumber: 43,
    incidentTitle: "Search timeout",
    serviceName: "search-api",
    severity: "sev3",
    incidentStatus: "triggered",
    agentType: "triage",
    status: "running",
    modelId: "test-model",
    rootCauseHypothesis: null,
    confidenceScore: null,
    evidenceCount: 0,
    toolCallCount: 0,
    recommendationCount: 0,
    estimatedCostCents: null,
    durationMs: null,
    createdAt: new Date("2026-06-24T13:00:00Z"),
    completedAt: null,
    reportSnapshotId: "018f0000-0000-7000-8000-000000000005",
    reportSnapshotCreatedAt: new Date("2026-06-24T13:01:00Z"),
    reportFeedbackAccuracy: "needs_more_evidence",
    reportFeedbackUpdatedAt: new Date("2026-06-24T13:02:00Z"),
    reportRejectedHypothesisCount: 1,
  },
];

describe("SreInvestigationsTable", () => {
  function openInvestigationActions(incidentNumber: number) {
    fireEvent.keyDown(screen.getByRole("button", { name: `Open actions for investigation #${incidentNumber}` }), {
      key: "Enter",
      code: "Enter",
    });
  }

  beforeEach(() => {
    mockCreateSreInvestigationReportSnapshot.mockResolvedValue({
      success: true,
      snapshotId: "018f0000-0000-7000-8000-000000000006",
      createdAt: "2026-06-24T12:01:00.000Z",
      reused: false,
    });
    mockSaveSreInvestigationReportFeedback.mockResolvedValue({
      success: true,
      feedbackId: "018f0000-0000-7000-8000-000000000007",
      accuracy: "incorrect",
      rejectedHypothesisCount: 2,
      updatedAt: "2026-06-24T13:03:00.000Z",
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockCreateSreInvestigationReportSnapshot.mockReset();
    mockSaveSreInvestigationReportFeedback.mockReset();
  });

  it("renders investigation rows and filters by query", () => {
    render(<SreInvestigationsTable investigations={investigations} />);

    expect(screen.getByText(/Checkout latency/)).toBeInTheDocument();
    expect(screen.getByText(/Search timeout/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search service, root cause, severity, model..."), {
      target: { value: "checkout" },
    });

    expect(screen.getByText(/Checkout latency/)).toBeInTheDocument();
    expect(screen.queryByText(/Search timeout/)).not.toBeInTheDocument();
  });

  it("downloads the sanitized investigation report export", async () => {
    let exportedBlob: Blob | null = null;
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: jest.fn() });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: jest.fn() });
    jest.mocked(URL.createObjectURL).mockImplementation((blob) => {
      exportedBlob = blob as Blob;
      return "blob:investigation-report";
    });
    jest.mocked(URL.revokeObjectURL).mockImplementation(() => undefined);
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<SreInvestigationsTable investigations={investigations} />);
    openInvestigationActions(42);
    fireEvent.click(await screen.findByRole("menuitem", { name: /export report/i }));

    expect(clickSpy).toHaveBeenCalled();
    expect(exportedBlob).not.toBeNull();
    const exportedText = await readBlobText(exportedBlob!);
    const exported = JSON.parse(exportedText);

    expect(exported).toMatchObject({
      version: "sre-investigation-report.v1",
      run: { id: "018f0000-0000-7000-8000-000000000001" },
      evidence: [{ id: "ev-checkout-5xx", citationResultHash: "hash-evidence" }],
      toolCalls: [{ inputHash: "hash-input", outputHash: "hash-output" }],
    });
    expect(exported.evidence[0]).not.toHaveProperty("rawContentExcerpt");
    expect(exported.evidence[0]).not.toHaveProperty("sourceUri");
    expect(exported.toolCalls[0]).not.toHaveProperty("rawInputS3Path");
    expect(exported.toolCalls[0]).not.toHaveProperty("rawOutputS3Path");
  });

  it("saves a persisted report snapshot", async () => {
    render(<SreInvestigationsTable investigations={investigations} />);

    openInvestigationActions(42);
    fireEvent.click(await screen.findByRole("menuitem", { name: /save snapshot/i }));

    await waitFor(() => {
      expect(mockCreateSreInvestigationReportSnapshot).toHaveBeenCalledWith({
        investigationRunId: "018f0000-0000-7000-8000-000000000001",
      });
    });
    await waitFor(() => {
      expect(screen.getAllByText("snapshot")).toHaveLength(2);
    });
  });

  it("saves reviewer feedback for a persisted report snapshot", async () => {
    render(<SreInvestigationsTable investigations={investigations} />);

    openInvestigationActions(43);
    fireEvent.click(await screen.findByRole("menuitem", { name: /^review$/i }));
    fireEvent.change(screen.getByLabelText("Rejected hypotheses"), {
      target: { value: "Cache saturation was not supported\nRegional DNS was unrelated" },
    });
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "The report needs stronger evidence for the timeout theory." },
    });
    fireEvent.click(screen.getByRole("button", { name: /save review/i }));

    await waitFor(() => {
      expect(mockSaveSreInvestigationReportFeedback).toHaveBeenCalledWith({
        reportSnapshotId: "018f0000-0000-7000-8000-000000000005",
        accuracy: "needs_more_evidence",
        notes: "The report needs stronger evidence for the timeout theory.",
        rejectedHypotheses: ["Cache saturation was not supported", "Regional DNS was unrelated"],
      });
    });
    expect(await screen.findByText("Incorrect · 2 rejected")).toBeInTheDocument();
  });

  it("shows load errors", () => {
    render(<SreInvestigationsTable investigations={[]} loadError="No access" />);

    expect(screen.getByText("SRE investigations unavailable")).toBeInTheDocument();
    expect(screen.getByText("No access")).toBeInTheDocument();
  });
});
