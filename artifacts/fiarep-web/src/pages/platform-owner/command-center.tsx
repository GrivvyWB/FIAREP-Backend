import { useMemo } from "react";
import { useSearch } from "wouter";
import { CommandCenterPanel } from "@/components/command-center-panel";

/** Platform Control → Command Center: FIAREP's own (the phone's remote control
 *  for FIAREP and the Mac), plus every client's on/off, usage and cap.
 *  ?client=ID: that client's setup (phones, computers, actions, email, scheduling, audit),
 *  run by FIAREP — the client itself only gets the services. */
export default function OwnerCommandCenter() {
  const search = useSearch();
  const q = useMemo(() => new URLSearchParams(search), [search]);
  const client = q.get("client");
  if (client) return (
    <div className="space-y-3">
      <a href="/platform-owner/command-center" className="text-sm font-medium text-[#185FA5] underline">← FIAREP's Command Center and all clients</a>
      <CommandCenterPanel key={client} scope="client" tenantId={client} tenantName={q.get("name") || undefined} />
    </div>
  );
  return <CommandCenterPanel scope="platform" />;
}
