import { GenericEntityPage } from "@/components/layout/generic-entity-page";
import { AlertTriangle } from "lucide-react";

export default function Violations() {
  return <GenericEntityPage entity="building-violations" title="Violations" description="Manage building violations." icon={AlertTriangle} />;
}
