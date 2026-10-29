import { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { currentLanguage, onLanguageChange, screenLanguages, setScreenLanguage, type ScreenLanguage } from "@/lib/screen-language";

/** Pick the language the website shows in (kept on this browser). */
export function LanguagePicker({ dark = false, className = "" }: { dark?: boolean; className?: string }) {
  const [langs, setLangs] = useState<ScreenLanguage[]>([{ code: "en", name: "English", rtl: false }]);
  const [code, setCode] = useState(currentLanguage());
  useEffect(() => { void screenLanguages().then(setLangs); return onLanguageChange(() => setCode(currentLanguage())); }, []);
  return (
    <label translate="no" className={`notranslate flex items-center gap-1.5 text-sm ${dark ? "text-slate-200" : "text-muted-foreground"} ${className}`} title="Language">
      <Globe className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="sr-only">Language</span>
      <select
        value={code}
        onChange={(e) => { const l = langs.find((x) => x.code === e.target.value); void setScreenLanguage(e.target.value, !!l?.rtl); }}
        className={`max-w-[9.5rem] cursor-pointer rounded-md border px-1.5 py-1 text-[13px] outline-none ${dark ? "border-slate-700 bg-slate-900 text-slate-100" : "border-border bg-white text-foreground"}`}
        aria-label="Language"
      >
        {langs.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
      </select>
    </label>
  );
}
