import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { jobs, runs } from "@/db/schema";

/**
 * API endpoint to return all currently running jobs
 * Used by the JobContext to maintain state across page refreshes
 */
export async function GET(): Promise<NextResponse> {
  try {
    // Find all active runs first - only those with running status
    const activeRuns = await db.query.runs.findMany({
      where: eq(runs.status, "running"),
      columns: {
        id: true,
        jobId: true
      }
    });
    
    // Only if we have active runs, get the corresponding job data
    if (activeRuns.length === 0) {
      return NextResponse.json({ runningJobs: [] });
    }
    
    // Extract job IDs from active runs
    const jobIds = [
      ...new Set(
        activeRuns
          .map((run) => run.jobId)
          .filter((jobId): jobId is string => Boolean(jobId))
      ),
    ];

    if (jobIds.length === 0) {
      return NextResponse.json({ runningJobs: [] });
    }
    
    // Get job details for these active runs
    const jobsWithRuns = await Promise.all(
      jobIds.map(async (jobId) => {
        const job = await db.query.jobs.findFirst({
          where: eq(jobs.id, jobId),
          columns: {
            id: true,
            name: true,
            status: true
          }
        });
        
        // Match with run ID
        const run = activeRuns.find(run => run.jobId === jobId);
        
        if (job && run) {
          return {
            jobId: job.id,
            name: job.name,
            runId: run.id
          };
        }
        return null;
      })
    );
    
    // Filter out null values and return
    const runningJobsData = jobsWithRuns.filter(Boolean);
    
    return NextResponse.json({ 
      runningJobs: runningJobsData 
    });
  } catch (error) {
    console.error("Error fetching running jobs:", error);
    return NextResponse.json(
      { error: "Failed to fetch running jobs" },
      { status: 500 }
    );
  }
} 
