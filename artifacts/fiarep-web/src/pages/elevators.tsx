import { GenericEntityPage } from "@/components/layout/generic-entity-page";
import { ArrowUpToLine } from "lucide-react";

export default function Elevators() {
  return <GenericEntityPage entity="elevator-jobs" title="Elevators" description="Manage elevator jobs." icon={ArrowUpToLine} />;
}
