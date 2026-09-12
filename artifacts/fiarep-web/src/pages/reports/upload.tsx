import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useRequestFileUploadUrl, useCreateEntityRecord, useUpdateEntityRecord, useListEntityRecords } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, UploadCloud, File as FileIcon } from "lucide-react";
import { Link } from "wouter";
import { invalidateOperationalQueries } from "@/lib/query-invalidation";

export default function UploadReport() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { staff } = useAuth();
  const queryClient = useQueryClient();
  const getUploadUrl = useRequestFileUploadUrl();
  const createRecord = useCreateEntityRecord();
  const updateRecord = useUpdateEntityRecord();
  const projects = useListEntityRecords("projects");
  
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [development, setDevelopment] = useState(
    staff?.developments?.length === 1 ? staff.developments[0]! : "",
  );
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const developments = [
    ...new Set([
      ...(staff?.developments ?? []),
      ...((projects.data ?? [])
        .map((project) => project.development)
        .filter((value): value is string => !!value)),
    ]),
  ].sort();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      if (!title) {
        setTitle(e.target.files[0].name.split('.')[0]);
      }
    }
  };

  const onUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    try {
      setIsUploading(true);

      const id = crypto.randomUUID();
      if (!development) {
        throw new Error("Select an authorized development.");
      }

      // 1. Create the authorized owner record before requesting file access.
      const created = await createRecord.mutateAsync({
        entity: "resident-reports",
        data: {
          id,
          state: {
            title: title || file.name,
          },
          development,
          version: 1,
        }
      });

      // 2. Get a presigned upload URL bound to that record.
      const { uploadUrl, file: storedFile } = await getUploadUrl.mutateAsync({
        data: {
          kind: "inspection-evidence",
          name: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
          entity: "resident-reports",
          recordId: id,
        }
      });

      // 3. Upload file directly to storage.
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
      });

      if (!uploadRes.ok) {
        throw new Error("Failed to upload file to storage.");
      }

      // 4. Attach the uploaded object to its authorized owner record.
      await updateRecord.mutateAsync({
        entity: "resident-reports",
        id,
        data: {
          id,
          state: {
            fileId: storedFile.id,
            remoteFiles: [storedFile],
          },
          version: created.version,
        }
      });

      toast({ title: "Success", description: "Report uploaded successfully." });
       await invalidateOperationalQueries(queryClient, "resident-reports", id);
      setLocation("/reports");

    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Upload Failed",
        description: err?.message || "An error occurred during upload.",
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/reports">
          <Button variant="outline" size="icon" className="shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Upload Report</h1>
          <p className="text-muted-foreground text-sm">Upload a new document or report.</p>
        </div>
      </div>

      <div className="bg-card rounded-[14px] shadow-sm border border-border p-6">
        <form onSubmit={onUpload} className="space-y-6">
          
          <div className="space-y-2">
            <Label>Report Title</Label>
            <Input 
              value={title} 
              onChange={e => setTitle(e.target.value)} 
              placeholder="e.g. Q3 Compliance Report" 
              required
              data-testid="input-report-title"
            />
          </div>

          <div className="space-y-2">
            <Label>Development</Label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              value={development}
              onChange={(event) => setDevelopment(event.target.value)}
              required
            >
              <option value="" disabled />
              {developments.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label>File</Label>
            
            <div 
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
                file ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
              }`}
              onClick={() => fileInputRef.current?.click()}
              data-testid="upload-dropzone"
            >
              <input 
                type="file" 
                ref={fileInputRef}
                className="hidden" 
                onChange={handleFileChange}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                data-testid="input-file-upload"
              />
              
              {file ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 rounded-full bg-primary/20 text-primary grid place-items-center">
                    <FileIcon className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="font-semibold">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}>
                    Remove
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 rounded-full bg-secondary text-muted-foreground grid place-items-center">
                    <UploadCloud className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">Click to select a file</p>
                    <p className="text-xs text-muted-foreground mt-1">PDF, Word, Excel, or Images up to 50MB</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Link href="/reports">
              <Button variant="ghost" type="button">Cancel</Button>
            </Link>
            <Button type="submit" disabled={!file || isUploading} data-testid="button-upload-report">
              {isUploading ? "Uploading..." : "Upload Report"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
