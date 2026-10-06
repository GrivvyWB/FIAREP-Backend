import { Button } from "@/components/ui/button";
import { JoinFiarepTab } from "@/components/join-fiarep-tab";

export function WebsiteFooter() {
  return (
    <footer className="border-t border-border bg-card/30 py-14">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 px-6 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1 text-center">
        <h2 className="text-3xl font-bold">Connect With FIAREP</h2>
        <p className="mt-4 text-lg text-muted-foreground">
          Have a question, partnership opportunity, or want to see FIAREP in action?
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild size="lg" variant="outline">
            <a href="mailto:fiarep@outlook.com?subject=Request%20a%20Demo">Request a Demo</a>
          </Button>
        </div>
      </div>
      {/* Join FIAREP: right side of the bottom section, in the page flow. */}
      <div className="shrink-0">
        <JoinFiarepTab />
      </div>
      </div>
    </footer>
  );
}