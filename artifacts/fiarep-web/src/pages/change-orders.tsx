import { GenericEntityPage } from "@/components/layout/generic-entity-page";
import { FileCog } from "lucide-react";

export default function ChangeOrders() {
  return (
    <GenericEntityPage
      entity="change-orders"
      title="Change Orders"
      description="Create, review, and manage project change orders."
      icon={FileCog}
    />
  );
}