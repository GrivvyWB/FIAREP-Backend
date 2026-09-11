import { GenericEntityPage } from "@/components/layout/generic-entity-page";
import { Briefcase } from "lucide-react";

export default function Projects() {
  return <GenericEntityPage entity="projects" title="Projects" description="Manage long-term project records." icon={Briefcase} />;
}
