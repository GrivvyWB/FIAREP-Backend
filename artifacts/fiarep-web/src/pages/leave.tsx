import { GenericEntityPage } from "@/components/layout/generic-entity-page";
import { Plane } from "lucide-react";

export default function Leave() {
  return <GenericEntityPage entity="leave-requests" title="Leave Requests" description="Manage leave requests." icon={Plane} />;
}
