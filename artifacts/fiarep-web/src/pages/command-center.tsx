import { CommandCenterPanel } from "@/components/command-center-panel";

/** A client's own Command Center (menu → Command Center, administrators):
 *  approve the company's phones, add its computers, switch its actions. */
export default function CommandCenter() {
  return <div className="p-6"><CommandCenterPanel scope="org" /></div>;
}
