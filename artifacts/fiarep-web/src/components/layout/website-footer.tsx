import { Button } from "@/components/ui/button";
import { JoinFiarepTab } from "@/components/join-fiarep-tab";

export function WebsiteFooter() {
  return (
    <footer className="relative border-t border-border bg-card/30 py-14">
      {/* Join FIAREP: upper-right corner of the bottom section, stays with the page. */}
      <div className="absolute right-6 top-6 hidden lg:block">
        <JoinFiarepTab />
      </div>
      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2 className="text-3xl font-bold">Connect With FIAREP</h2>
        <p className="mt-4 text-lg text-muted-foreground">
          Have a question, partnership opportunity, or want to see FIAREP in action?
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild size="lg" variant="outline">
            <a href="mailto:fiarep@outlook.com?subject=Request%20a%20Demo">Request a Demo</a>
          </Button>
        </div>
        <div className="mt-10 flex justify-end lg:hidden">
          <JoinFiarepTab />
        </div>
      </div>
    </footer>
  );
}