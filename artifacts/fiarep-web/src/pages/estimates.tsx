import { GenericEntityPage } from "@/components/layout/generic-entity-page";
import { FileText } from "lucide-react";

export default function Estimates() {
  return <GenericEntityPage entity="cost-estimates" title="Estimates" description="Manage repair estimate records." icon={FileText} />;
}
