import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Download, FileText, Lock } from "lucide-react";

type Form = { file: string; title: string; group: string; description: string };

/** FIAREP's compliance forms — a locked folder, only for the organization
 * the platform owner unlocked it for. Opens / downloads through the signed-in
 * session, never a public link. */
export default function CompanyForms() {
  const { toast } = useToast();
  const [forms, setForms] = useState<Form[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    customFetch<Form[]>("/api/v1/company-forms", { responseType: "json" } as never)
      .then(setForms)
      .catch((err: any) => setError(err?.data?.error || err?.message || "Could not load the forms."));
  }, []);

  async function open(form: Form, download: boolean) {
    setBusy(form.file);
    try {
      const blob = await customFetch<Blob>(`/api/v1/company-forms/${encodeURIComponent(form.file)}`, { responseType: "blob" } as never);
      const url = URL.createObjectURL(blob);
      if (download) {
        const a = document.createElement("a"); a.href = url; a.download = form.file; a.click();
      } else {
        window.open(url, "_blank", "noopener");
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not open", description: err?.data?.error || err?.message || "Try again." });
    } finally { setBusy(""); }
  }

  const groups = forms ? [...new Set(forms.map((f) => f.group))] : [];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Lock className="h-6 w-6" />Company Forms</h1>
        <p className="text-sm text-muted-foreground">FIAREP's compliance forms. This folder is locked to our own organization — client staff can't see it.</p>
      </div>
      {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {forms && groups.map((g) => (
        <section key={g}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{g}</h2>
          <div className="space-y-2">
            {forms.filter((f) => f.group === g).map((f) => (
              <div key={f.file} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
                <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{f.title}</p>
                  <p className="text-xs text-muted-foreground">{f.description}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={busy === f.file} onClick={() => void open(f, false)}>Open</Button>
                  <Button size="sm" disabled={busy === f.file} onClick={() => void open(f, true)}><Download className="mr-1 h-4 w-4" />Download</Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
