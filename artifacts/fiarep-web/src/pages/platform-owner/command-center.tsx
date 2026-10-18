import { CommandCenterPanel } from "@/components/command-center-panel";

/** Platform Control → Command Center: FIAREP's own (the phone's remote control
 *  for FIAREP and the Mac), plus every client's on/off, usage and cap. */
export default function OwnerCommandCenter() {
  return <CommandCenterPanel scope="platform" />;
}
