import { GenericEntityPage } from "@/components/layout/generic-entity-page";
import { Users } from "lucide-react";

export default function Clients() {
  return <GenericEntityPage entity="intakes" title="Clients" description="Manage development and client intake records." icon={Users} />;
}
