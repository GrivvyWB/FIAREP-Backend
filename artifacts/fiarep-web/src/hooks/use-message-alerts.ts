import { useEffect, useRef } from "react";
import { customFetch } from "@workspace/api-client-react";
import { messageAlert, primeMessageSound } from "@/lib/message-alert";

/** Signed in: check every 20 seconds; when unread messages go up, chime and show a notice. */
export function useMessageAlerts(onNew?: (who: string, body: string) => void): void {
  const last = useRef<number | null>(null);
  useEffect(() => {
    const prime = () => { primeMessageSound(); window.removeEventListener("pointerdown", prime); };
    window.addEventListener("pointerdown", prime);
    let alive = true;
    const check = async () => {
      try {
        const r = await customFetch<{ unread: number; latest: { who: string; body: string } | null }>("/api/v1/messages/unread", { responseType: "json" } as never);
        if (!alive) return;
        if (last.current !== null && r.unread > last.current) {
          const who = r.latest?.who || "Someone";
          messageAlert(`New message from ${who}`, r.latest?.body || "");
          onNew?.(who, r.latest?.body || "");
        }
        last.current = r.unread;
      } catch { /* try again next time */ }
    };
    void check();
    const t = setInterval(() => void check(), 20_000);
    return () => { alive = false; clearInterval(t); window.removeEventListener("pointerdown", prime); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
