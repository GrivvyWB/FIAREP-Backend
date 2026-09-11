import { useListEntityRecords } from "@workspace/api-client-react";
import { FolderOpen, Search, Plus, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Link } from "wouter";

export default function Reports() {
  const { data: reports, isLoading } = useListEntityRecords("resident-reports");
  const [search, setSearch] = useState("");

  const filtered = reports?.filter(i => {
    if (!search) return true;
    const itemTitle = (i.state as any)?.title?.toLowerCase() || i.id.toLowerCase();
    const q = search.toLowerCase();
    return itemTitle.includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground text-sm">Manage resident and inspection report records.</p>
        </div>
        <Link href="/reports/upload">
          <Button className="font-semibold gap-2">
            <Upload className="w-4 h-4" /> Upload Report
          </Button>
        </Link>
      </div>

      <div className="bg-card rounded-[14px] shadow-sm border border-border">
        <div className="p-4 border-b border-border flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search reports..." 
              className="pl-9"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="p-4">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading reports...</div>
          ) : filtered?.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center">
              <FolderOpen className="w-12 h-12 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-bold">No reports found</h3>
              <p className="text-sm text-muted-foreground mt-1">Upload a report to get started.</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {filtered?.map(item => (
                <div key={item.id} className="flex items-center gap-4 p-4 rounded-xl border border-border hover:bg-muted/30 transition-colors">
                  <div className="w-12 h-12 rounded-[9px] bg-secondary text-secondary-foreground grid place-items-center shrink-0">
                    <FolderOpen className="w-6 h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-[15px] truncate">{(item.state as any)?.title || `Report ${item.id.slice(0,8)}`}</h4>
                    <div className="text-xs text-muted-foreground mt-1 capitalize">
                      Status: {(item.state as any)?.status || "Uploaded"}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-muted-foreground block">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
