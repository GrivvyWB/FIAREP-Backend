import { useLocation } from "wouter";

/**
 * The 24/7 FIAREP badge, bottom-right on every public page. Pressing it opens
 * the Join FIAREP page for management companies that want the service.
 */
export function JoinFiarepTab() {
  const [location, setLocation] = useLocation();
  if (location === "/join") return null;
  return (
    <button
      type="button"
      onClick={() => setLocation("/join")}
      aria-label="Join FIAREP — management service and expediting"
      className="flex items-center gap-3 rounded-2xl border border-amber-500/40 bg-white p-2 pr-4 shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
    >
      <img src="/platform-media/fiarep-247-logo.png" alt="24/7 FIAREP Management Service / Expediting" className="h-28 w-auto sm:h-32" />
      <span className="text-left">
        <span className="block text-2xl font-bold text-slate-900">Join FIAREP</span>
      </span>
    </button>
  );
}
