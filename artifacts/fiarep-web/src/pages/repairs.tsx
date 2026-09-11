import { GenericEntityPage } from "@/components/layout/generic-entity-page";
import { Wrench } from "lucide-react";

export default function Repairs() {
  return <GenericEntityPage entity="project-scopes" title="Repairs" description="Manage repair scopes and job records." icon={Wrench} />;
}
