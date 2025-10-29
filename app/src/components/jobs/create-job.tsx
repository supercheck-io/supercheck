"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Test } from "./schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SaveIcon } from "lucide-react";
import { createJob } from "@/actions/create-job";
import { toast } from "sonner";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/form";
import { ControllerRenderProps } from "react-hook-form";
import TestSelector from "./test-selector";
import CronScheduler from "./cron-scheduler";
import { Loader2 } from "lucide-react";
import NextRunDisplay from "./next-run-display";

const jobFormSchema = z.object({
  name: z.string().min(1, "Job name is required"),
  description: z.string().min(1, "Job description is required"),
  cronSchedule: z.string().optional(),
});

type FormData = z.infer<typeof jobFormSchema>;

interface CreateJobProps {
  hideAlerts?: boolean;
  onSave?: (data: Record<string, unknown>) => void;
  onCancel?: () => void;
  initialValues?: {
    name?: string;
    description?: string;
    cronSchedule?: string;
  };
  selectedTests?: Test[];
  setSelectedTests?: (tests: Test[]) => void;
}

export function CreateJob({ 
  hideAlerts = false, 
  onSave, 
  onCancel, 
  initialValues = {}, 
  selectedTests = [], // Default to empty array
  setSelectedTests 
}: CreateJobProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(jobFormSchema),
    defaultValues: {
      name: initialValues.name || "",
      description: initialValues.description || "",
      cronSchedule: initialValues.cronSchedule || "",
    },
  });

  // Handle form submission
  const onSubmit = form.handleSubmit(async (values: FormData) => {
    setIsSubmitting(true);
    try {
      const jobData = {
        name: values.name.trim(),
        description: values.description.trim(),
        cronSchedule: values.cronSchedule?.trim() || "",
        tests: Array.isArray(selectedTests) ? selectedTests : [], // Ensure array
      };

      if (onSave) {
        onSave(jobData);
        return;
      }

      const response = await createJob(jobData);
      if (response.success) {
        toast.success("Success", {
          description: `Job \"${jobData.name}\" has been created.`,
        });
        router.push("/jobs");
      } else {
        console.error("Failed to create job:", response.error);
        toast.error("Failed to create job", {
          description: typeof response.error === 'string' ? response.error : "An unknown error occurred",
        });
      }
    } catch (error) {
      console.error("Error creating job:", error);
      toast.error("Error", {
        description: error instanceof Error ? error.message : "An unexpected error occurred",
      });
    } finally {
      setIsSubmitting(false);
    }
  });

  return (
    <div className="space-y-4 p-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-6">
          <div>
            <CardTitle>Create New Job</CardTitle>
            <CardDescription className="mt-2">Configure a new automated or manual job</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <Form {...form}>
            <form onSubmit={onSubmit} className="space-y-6">
              {/* Main grid: Left column for Name/Desc, Right for Cron */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left Column: Name and Description */}
                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({
                      field,
                    }: {
                      field: ControllerRenderProps<FormData, "name">;
                    }) => (
                      <FormItem>
                        <FormLabel>Job Name</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Enter job name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }: { field: ControllerRenderProps<FormData, "description"> }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            placeholder="Enter job description"
                            className="min-h-[100px]"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Right Column: Cron Scheduler */}
                <div className="space-y-4"> 
                  <FormField
                    control={form.control}
                    name="cronSchedule"
                    render={({
                      field,
                    }: {
                      field: ControllerRenderProps<FormData, "cronSchedule">;
                    }) => (
                      <FormItem>
                        <FormLabel className="mb-6">
                          Cron Schedule (UTC){" "}
                          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Optional</span>
                        </FormLabel>
                        <FormControl>
                          <CronScheduler 
                            value={field.value || ""}
                            onChange={field.onChange}
                          />
                        </FormControl>
                        <NextRunDisplay cronExpression={field.value} />
                        <p className="text-xs text-muted-foreground mt-4 flex items-center">
                         <span>Leave empty for manual execution</span>
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Test Selector - now guaranteed to receive an array */}
              <TestSelector
                selectedTests={selectedTests}
                onTestsSelected={setSelectedTests || (() => {})}
                buttonLabel="Select Tests"
                required={true}
              />

              <div className="flex justify-end space-x-4 mt-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (onCancel) onCancel();
                    else router.push("/jobs");
                  }}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  className="flex items-center"
                  disabled={isSubmitting || (hideAlerts && selectedTests.length === 0)}
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <SaveIcon className="h-4 w-4 mr-2" />
                  )}
                  {isSubmitting ? "Processing..." : "Next: Alert Settings"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

// Default export for backward compatibility
export default CreateJob;
