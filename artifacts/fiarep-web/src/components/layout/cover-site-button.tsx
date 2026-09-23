import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { useListNychaDevelopments } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type ActiveCoverage = { development: string; expiresAt: string };

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("fiarep_access_token") || ""}`,
  };
}

function formatExpiry(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * "Cover a site" — lets a floating supervisor/superintendent unlock the ability
 * to ACT on a development that isn't theirs by confirming its 2-digit code.
 * Viewing other developments is always allowed; this is only about acting.
 */
export function CoverSiteButton() {
  const { toast } = useToast();
  const { data: developmentOptions = [] } = useListNychaDevelopments();
  const [open, setOpen] = useState(false);
  const [development, setDevelopment] = useState("");
  const [expectedCode, setExpectedCode] = useState("");
  const [code, setCode] = useState("");
  const [active, setActive] = useState<ActiveCoverage[]>([]);
  const [loading, setLoading] = useState(false);

  const loadActive = async () => {
    try {
      const r = await fetch("/api/v1/coverage/active", { headers: authHeaders() });
      if (r.ok) setActive(await r.json());
    } catch {
      /* best effort */
    }
  };

  useEffect(() => {
    if (open) loadActive();
  }, [open]);

  // Populate the development's 2-digit code once a full name is chosen.
  useEffect(() => {
    const name = development.trim();
    if (!name) {
      setExpectedCode("");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/v1/coverage/development-code?development=${encodeURIComponent(name)}`,
          { headers: authHeaders() },
        );
        if (!cancelled) setExpectedCode(r.ok ? (await r.json()).code : "");
      } catch {
        if (!cancelled) setExpectedCode("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [development]);

  const unlock = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/v1/coverage/unlock", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ development: development.trim(), code: code.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast({
          variant: "destructive",
          title: "Couldn't unlock",
          description: j.error || "Please try again.",
        });
        return;
      }
      toast({
        title: "Site unlocked",
        description: `Checked in at ${development.trim()} — you can assign across all developments for 24 hours.`,
      });
      setCode("");
      setDevelopment("");
      setExpectedCode("");
      loadActive();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 h-9 px-3 rounded-[9px] border border-border bg-white text-[12.5px] font-semibold text-foreground hover:bg-muted transition-colors"
          title="Unlock another development for today"
        >
          <MapPin className="w-4 h-4 text-[#185FA5]" />
          <span className="hidden md:inline">Cover a site</span>
          {active.length > 0 && (
            <span className="ml-0.5 bg-[#185FA5] text-white text-[10px] font-bold min-w-[16px] h-4 px-1 rounded-full grid place-items-center">
              {active.length}
            </span>
          )}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cover a site today</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Working at a development that isn't yours today? Confirm the site's 2-digit code to
            check in — that unlocks the ability to assign at every development for the next 24
            hours. (You can always view other developments; this grants the ability to act.)
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="cover-dev">Development</Label>
            <Input
              id="cover-dev"
              list="cover-dev-options"
              value={development}
              onChange={(e) => {
                setDevelopment(e.target.value);
                setCode("");
              }}
              placeholder="Start typing…"
              autoComplete="off"
            />
            <datalist id="cover-dev-options">
              {developmentOptions.map((d) => (
                <option key={d.id} value={d.name} />
              ))}
            </datalist>
          </div>
          {expectedCode && (
            <div className="rounded-md bg-muted/60 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Code for </span>
              <b>{development.trim()}</b>
              <span className="text-muted-foreground">: </span>
              <span className="font-mono font-bold tracking-widest text-[#185FA5]">
                {expectedCode}
              </span>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="cover-code">Enter the 2-digit code</Label>
            <Input
              id="cover-code"
              inputMode="numeric"
              maxLength={2}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 2))}
              placeholder="00"
              className="w-24 tracking-[0.4em] font-mono text-center"
            />
          </div>
          {active.length > 0 && (
            <div className="pt-1">
              <div className="text-xs font-semibold text-muted-foreground mb-1">
                Active coverage
              </div>
              <div className="flex flex-wrap gap-1.5">
                {active.map((a) => (
                  <Badge key={a.development} variant="secondary" className="font-normal">
                    {a.development} · until {formatExpiry(a.expiresAt)}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={unlock}
            disabled={loading || !development.trim() || code.length !== 2}
          >
            {loading ? "Unlocking…" : "Unlock for 24 hours"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
