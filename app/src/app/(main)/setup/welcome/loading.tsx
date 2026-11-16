import { Card, CardContent } from "@/components/ui/card";
import { SetupSkeleton } from "@/components/setup/setup-page";

export default function Loading() {
  return (
    <Card className="shadow-sm m-4">
      <CardContent className="p-6">
        <SetupSkeleton />
      </CardContent>
    </Card>
  );
}
