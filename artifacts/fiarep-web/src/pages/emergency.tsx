import { GenericEntityPage } from "@/components/layout/generic-entity-page";
import { BellRing } from "lucide-react";

export default function Emergency() {
  return <GenericEntityPage entity="emergency-jobs" title="Emergency" description="Manage emergency jobs." icon={BellRing} />;
}
