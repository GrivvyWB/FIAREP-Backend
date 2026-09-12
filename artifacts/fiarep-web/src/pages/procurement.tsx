import { GenericEntityPage } from "@/components/layout/generic-entity-page";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { LogOut, ShoppingCart } from "lucide-react";

export default function Procurement() {
  const { logout } = useAuth();

  return (
    <GenericEntityPage
      workflow
      entity="procurement"
      title="Procurement"
      description="Approved scopes only: release to vendors, award, close, or return for review."
      icon={ShoppingCart}
      headerAction={
        <Button variant="outline" onClick={logout} className="gap-2" data-testid="button-procurement-sign-out">
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      }
    />
  );
}
