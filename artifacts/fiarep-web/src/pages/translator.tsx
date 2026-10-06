import { useEffect, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { LANGUAGES, STAFF_LANGUAGE } from "@/lib/languages";
import { Languages, Mic, Square, Volume2, Loader2, ArrowLeftRight, Trash2 } from "lucide-react";

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

type Turn = { who: "resident" | "me"; heard: string; said: string; from: string; to: string; audio?: string };

async function post<T>(path: string, body: unknown): Promise<T> {
  return customFetch<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), responseType: "json" } as never);
}
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Voice-to-voice interpreter: the resident talks, the staff member hears /
 * reads it in English; the staff member answers, the phone says it back in
 * the resident's language through the speaker. */
export default function Translator() {
  const { toast } = useToast();
  const [residentLang, setResidentLang] = useState(LANGUAGES[0]!.name);
  const [customLang, setCustomLang] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [recording, setRecording] = useState<"resident" | "me" | null>(null);
  const [busy, setBusy] = useState("");
  const [typed, setTyped] = useState("");
  const [autoSpeak, setAutoSpeak] = useState(true);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const countRef = useRef(0);
  const language = customLang.trim() || residentLang;
  const langCode = LANGUAGES.find((l) => l.name === residentLang)?.code || "";

  useEffect(() => () => { recorderRef.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  async function startRecording(who: "resident" | "me") {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast({ variant: "destructive", title: "This browser can't record audio — type instead" });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); void finishRecording(who, new Blob(chunksRef.current, { type: rec.mimeType || mime || "audio/webm" })); };
      rec.start();
      recorderRef.current = rec;
      setRecording(who);
    } catch {
      toast({ variant: "destructive", title: "Microphone not allowed", description: "Allow the microphone for fiarep.com and try again." });
    }
  }
  function stopRecording() { recorderRef.current?.stop(); recorderRef.current = null; setRecording(null); }

  async function finishRecording(who: "resident" | "me", blob: Blob) {
    if (blob.size < 1000) { toast({ title: "Nothing heard — hold the button and speak" }); return; }
    setBusy("Listening…");
    try {
      const audio = await blobToBase64(blob);
      const { text } = await post<{ text: string }>("/api/ai/transcribe", { audio, mimeType: blob.type, language: who === "resident" ? (customLang ? "" : langCode) : "en" });
      if (!text) { toast({ title: "Nothing heard — try again closer to the phone" }); return; }
      await handleText(who, text);
    } catch (error) {
      toast({ variant: "destructive", title: "Could not translate", description: error instanceof Error ? error.message : "Try again." });
    } finally { setBusy(""); }
  }

  async function handleText(who: "resident" | "me", text: string) {
    setBusy("Translating…");
    const from = who === "resident" ? (customLang ? "auto" : language) : STAFF_LANGUAGE.name;
    const to = who === "resident" ? STAFF_LANGUAGE.name : language;
    const result = await post<{ translation: string; detectedLanguage: string }>("/api/ai/translate", { text, to, from });
    const turn: Turn = { who, heard: text, said: result.translation, from: who === "resident" ? (result.detectedLanguage || language) : "English", to };
    const idx = countRef.current++;
    setTurns((t) => [...t, turn]);
    if (who === "resident" && customLang && result.detectedLanguage) setResidentLang((cur) => LANGUAGES.some((l) => l.name === result.detectedLanguage) ? result.detectedLanguage : cur);
    if (autoSpeak) await speak(result.translation, idx);
  }

  async function speak(text: string, index: number) {
    setBusy("Speaking…");
    try {
      const { audioBase64, mimeType } = await post<{ audioBase64: string; mimeType: string }>("/api/ai/speak", { text });
      const src = `data:${mimeType};base64,${audioBase64}`;
      setTurns((t) => t.map((turn, i) => (i === index ? { ...turn, audio: src } : turn)));
      if (!audioRef.current) audioRef.current = new Audio();
      audioRef.current.src = src;
      await audioRef.current.play();
    } catch { toast({ title: "Translated — couldn't play the audio on this device" }); }
    finally { setBusy(""); }
  }

  async function sendTyped() {
    const text = typed.trim(); if (!text) return;
    setTyped("");
    try { await handleText("me", text); } catch (error) { toast({ variant: "destructive", title: "Could not translate", description: error instanceof Error ? error.message : "Try again." }); } finally { setBusy(""); }
  }

  const big = (who: "resident" | "me", label: string, sub: string) => {
    const active = recording === who;
    return (
      <button
        type="button"
        disabled={!!busy || (recording !== null && !active)}
        onClick={() => (active ? stopRecording() : void startRecording(who))}
        className={`flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border-2 p-6 text-center transition ${active ? "border-red-500 bg-red-50 animate-pulse" : "border-border bg-card hover:bg-muted"} disabled:opacity-50`}
      >
        {active ? <Square className="h-10 w-10 text-red-600" /> : <Mic className="h-10 w-10" />}
        <span className="text-lg font-semibold">{active ? "Tap to stop" : label}</span>
        <span className="text-xs text-muted-foreground">{sub}</span>
      </button>
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Languages className="h-6 w-6" />Translator</h1>
        <p className="text-sm text-muted-foreground">The resident speaks, you hear and read it in English. You answer, the phone says it back in their language.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
        <div>
          <p className="mb-1 text-sm font-medium">Resident speaks</p>
          <select className={selectClass} value={residentLang} onChange={(e) => { setResidentLang(e.target.value); setCustomLang(""); }}>
            {LANGUAGES.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <p className="mb-1 text-sm font-medium">Other language (type it)</p>
          <input className={selectClass} value={customLang} onChange={(e) => setCustomLang(e.target.value)} placeholder="e.g. Uzbek" />
        </div>
        <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" checked={autoSpeak} onChange={(e) => setAutoSpeak(e.target.checked)} />Speak out loud</label>
      </div>

      <div className="flex gap-3">
        {big("resident", `Resident speaks (${language})`, "Tap, let them talk, tap to stop")}
        <ArrowLeftRight className="self-center h-6 w-6 text-muted-foreground shrink-0" />
        {big("me", "I speak (English)", `Said back in ${language} through the speaker`)}
      </div>
      {busy && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{busy}</p>}

      <div className="flex gap-2">
        <Textarea rows={2} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`Or type in English — it will be said in ${language}`} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendTyped(); } }} />
        <Button onClick={() => void sendTyped()} disabled={!!busy || !typed.trim()}>Translate &amp; say</Button>
      </div>

      <div className="space-y-2">
        {turns.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing yet. Tap a button and talk.</p>}
        {turns.map((t, i) => (
          <div key={i} className={`rounded-lg border p-3 ${t.who === "resident" ? "bg-amber-50 border-amber-200" : "bg-card"}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.who === "resident" ? `Resident · ${t.from}` : "You · English"}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t.heard}</p>
            <p className="mt-1 text-lg font-medium">{t.said}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { if (t.audio && audioRef.current) { audioRef.current.src = t.audio; void audioRef.current.play(); } else void speak(t.said, i); }}><Volume2 className="mr-1 h-4 w-4" />Play</Button>
            </div>
          </div>
        ))}
        {turns.length > 0 && <Button variant="ghost" size="sm" onClick={() => { setTurns([]); countRef.current = 0; }}><Trash2 className="mr-1 h-4 w-4" />Clear conversation</Button>}
      </div>
      <p className="text-xs text-muted-foreground">Nothing here is saved. Copy anything important into the resident's notes.</p>
    </div>
  );
}
