import { GenericEntityPage } from "@/components/layout/generic-entity-page";
import { ShoppingCart } from "lucide-react";

export default function Procurement() {
  return <GenericEntityPage entity="procurement" title="Procurement" description="Manage procurement requests." icon={ShoppingCart} />;
}
