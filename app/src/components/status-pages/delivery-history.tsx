"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getStatusPageDeliveries,
  retryStatusPageDelivery,
} from "@/actions/status-page-deliveries";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

type Delivery = Awaited<
  ReturnType<typeof getStatusPageDeliveries>
>["deliveries"][number];

export function DeliveryHistory({ statusPageId }: { statusPageId: string }) {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const result = await getStatusPageDeliveries(statusPageId);
    if (result.success) {
      setDeliveries(result.deliveries);
      setError(null);
    } else setError(result.message);
  }, [statusPageId]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">Notification deliveries</h3>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Latest 100 deliveries. Retrying a failed delivery sends the original
        public update. A recipient may receive a duplicate after an interrupted
        request.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : deliveries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No notifications have been delivered yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Incident</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell>{delivery.incidentName}</TableCell>
                  <TableCell>{delivery.mode}</TableCell>
                  <TableCell>
                    <span>{delivery.status}</span>
                    {delivery.lastError && (
                      <p className="max-w-sm break-words text-xs text-muted-foreground">
                        {delivery.lastError}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>{delivery.attempts}</TableCell>
                  <TableCell>
                    {delivery.status === "failed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={async () => {
                          setBusy(delivery.id);
                          try {
                            const result = await retryStatusPageDelivery(
                              statusPageId,
                              delivery.id,
                            );
                            if (result.success) {
                              toast.success(result.message);
                              await load();
                            } else toast.error(result.message);
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        {busy === delivery.id ? "Queuing…" : "Retry"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
