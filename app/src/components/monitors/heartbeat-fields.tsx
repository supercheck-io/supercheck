"use client";

import type { UseFormReturn } from "react-hook-form";
import { Info } from "lucide-react";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FormValues } from "./monitor-form";

type DurationField = {
  value: "heartbeatConfig_every" | "heartbeatConfig_grace";
  unit: "heartbeatConfig_everyUnit" | "heartbeatConfig_graceUnit";
  label: string;
  help: string;
  units: Array<"minutes" | "hours" | "days">;
};

const FIELDS: DurationField[] = [
  {
    value: "heartbeatConfig_every",
    unit: "heartbeatConfig_everyUnit",
    label: "Expect a ping every",
    help: "From 1 minute to 31 days.",
    units: ["minutes", "hours", "days"],
  },
  {
    value: "heartbeatConfig_grace",
    unit: "heartbeatConfig_graceUnit",
    label: "Grace period",
    help: "How late a ping may be before the monitor goes down.",
    units: ["minutes", "hours", "days"],
  },
];

/** Heartbeat interval and grace period: a number plus a unit each. No target, method or locations. */
export function HeartbeatFields({ form, editMode = false }: { form: UseFormReturn<FormValues>; editMode?: boolean }) {
  return (
    <div className="space-y-4" data-testid="heartbeat-fields">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {FIELDS.map((field) => (
          <FormField
            key={field.value}
            control={form.control}
            name={field.value}
            render={({ field: input }) => (
              <FormItem>
                <FormLabel>{field.label}</FormLabel>
                <div className="flex gap-2">
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      className="w-24"
                      data-testid={`${field.value}-value`}
                      {...input}
                      value={input.value ?? ""}
                    />
                  </FormControl>
                  <FormField
                    control={form.control}
                    name={field.unit}
                    render={({ field: unit }) => (
                      <Select value={unit.value} onValueChange={unit.onChange}>
                        <SelectTrigger className="w-32" aria-label={`${field.label} unit`} data-testid={`${field.value}-unit`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {field.units.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <FormDescription>{field.help}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
      </div>
      {!editMode && (
      <p className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground" role="note">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        The ping URL appears after you create the monitor. Add it to the end of your cron job or scheduled agent.
      </p>
      )}
    </div>
  );
}
