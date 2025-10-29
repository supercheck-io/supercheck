import { Clock, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { CreateCard } from "@/components/create/create-card";

export function JobCreationCard() {
  const router = useRouter();

  return (
    <div>
      <h2 className="text-2xl font-bold">Create New Job</h2>
      <p className="text-muted-foreground">
        Configure a new automated or manual job
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
        <CreateCard
          icon={<Clock size={24} />}
          title="Scheduled Job"
          description="Create a job that runs on a schedule"
          onClick={() => router.push('/jobs/create/scheduled')}
        />
        <CreateCard
          icon={<Zap size={24} />}
          title="Immediate Job"
          description="Run a job immediately"
          onClick={() => router.push('/jobs/create/immediate')}
        />
      </div>
    </div>
  );
}
