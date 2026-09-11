import { GenericEntityPage } from "@/components/layout/generic-entity-page";
import { ShoppingCart } from "lucide-react";

export default function Procurement() {
  return <GenericEntityPage workflow entity="procurement" title="Procurement" description="Approved scopes only: release to vendors, award, close, or return for review." icon={ShoppingCart} />;
}
