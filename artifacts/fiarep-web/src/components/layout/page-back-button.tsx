import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

export function PageBackButton() {
  const [, navigate] = useLocation();

  const goBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    navigate("/");
  };

  return (
    <Button variant="ghost" size="sm" className="-ml-2 mb-2 gap-2" onClick={goBack}>
      <ArrowLeft className="h-4 w-4" />
      Back
    </Button>
  );
}