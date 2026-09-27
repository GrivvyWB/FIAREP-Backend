// Phrase help for complaint / report text boxes (website).
//  • Matching phrases appear as chips while typing.
//  • With `picker`, a collapsible "Pick an issue" drop-down lists every phrase by trade.
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { PHRASE_GROUPS, suggestPhrases, applyPhrase } from "@/lib/complaint-phrases";

type Props = { value: string; onChange: (next: string) => void; picker?: boolean; label?: string };

export function PhraseHelper({ value, onChange, picker = false, label = "Pick an issue" }: Props) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<string | null>(null);
  const suggestions = suggestPhrases(value || "");
  const pick = (phrase: string) => {
    onChange(applyPhrase(value || "", phrase));
    setOpen(false);
    setGroup(null);
  };
  return (
    <div className="space-y-2">
      {suggestions.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Did you mean:</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((phrase) => (
              <button key={phrase} type="button" onClick={() => pick(phrase)}
                className="rounded-full border border-primary/40 bg-primary/5 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10">
                {phrase}
              </button>
            ))}
          </div>
        </div>
      )}
      {picker && (
        <div className="overflow-hidden rounded-md border bg-background">
          <button type="button" onClick={() => { setOpen(!open); setGroup(null); }}
            className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold text-primary">
            {label}{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {open && PHRASE_GROUPS.map((g) => (
            <div key={g.label} className="border-t">
              <button type="button" onClick={() => setGroup(group === g.label ? null : g.label)}
                className="flex w-full items-center justify-between bg-muted/40 px-3 py-2 text-sm font-medium">
                {g.label}<span className="text-muted-foreground">{group === g.label ? "−" : "+"}</span>
              </button>
              {group === g.label && g.phrases.map((phrase) => (
                <button key={g.label + phrase} type="button" onClick={() => pick(phrase)}
                  className="block w-full border-t px-6 py-2 text-left text-sm hover:bg-muted/40">
                  {phrase}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
