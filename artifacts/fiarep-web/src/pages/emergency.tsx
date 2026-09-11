import { GenericEntityPage } from "@/components/layout/generic-entity-page";
import { BellRing, Radio } from "lucide-react";

export default function Emergency() {
  return (
    <div className="space-y-10">
      <GenericEntityPage
        entity="emergency-jobs"
        title="Emergency Jobs"
        description="Manage emergency jobs and dispatch workflow."
        icon={BellRing}
        workflow
      />
      <GenericEntityPage
        entity="emergency-units"
        title="Emergency Units"
        description="Manage the units available for emergency response."
        icon={Radio}
      />
    </div>
  );
}
