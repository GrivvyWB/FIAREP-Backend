import { Button } from "@/components/ui/button";

export function WebsiteFooter() {
  return (
    <footer className="border-t border-border bg-card/30 py-14">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2 className="text-3xl font-bold">Connect With FIAREP</h2>
        <p className="mt-4 text-lg text-muted-foreground">
          Have a question, partnership opportunity, or want to see FIAREP in action?
        </p>
        <p className="mt-2 text-lg text-muted-foreground">
          Contact Timothy Winn, Founder of FIAREP.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <a href="mailto:fiarep@outlook.com">Contact FIAREP</a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="mailto:fiarep@outlook.com?subject=Request%20a%20Demo">Request a Demo</a>
          </Button>
        </div>
      </div>
    </footer>
  );
}