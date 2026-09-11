import { useListStaff } from "@workspace/api-client-react";
import { UsersRound, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";

export default function Team() {
  const { data: staff, isLoading } = useListStaff();
  const [search, setSearch] = useState("");

  const authorityOrder = (member: NonNullable<typeof staff>[number]) => {
    if (member.position === "Borough Director") return 0;
    if (member.role === "administrator") return 1;
    if (member.role === "management") return 2;
    if (member.role === "procurement") return 3;
    if (member.role === "worker") return 4;
    if (member.role === "inspector") return 5;
    return 6;
  };

  const filtered = staff
    ?.filter(s => {
      if (!search) return true;
      const q = search.toLowerCase();
      return s.name.toLowerCase().includes(q)
        || s.role.toLowerCase().includes(q)
        || s.position.toLowerCase().includes(q);
    })
    .sort((a, b) => authorityOrder(a) - authorityOrder(b) || a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Team Directory</h1>
        <p className="text-muted-foreground text-sm">View staff directory and authority.</p>
      </div>

      <div className="bg-card rounded-[14px] shadow-sm border border-border">
        <div className="p-4 border-b border-border flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search team members..." 
              className="pl-9"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="p-4">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading team...</div>
          ) : filtered?.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center">
              <UsersRound className="w-12 h-12 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-bold">No team members found</h3>
            </div>
          ) : (
            <div className="grid gap-3">
              {filtered?.map(member => (
                <div key={member.id} className="flex items-center gap-4 p-4 rounded-xl border border-border hover:bg-muted/30 transition-colors">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#3d6fa8] to-[#185FA5] text-white grid place-items-center font-bold text-sm shrink-0">
                    {member.name.split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-[15px] truncate">{member.name}</h4>
                    <div className="text-sm text-muted-foreground mt-0.5">{member.position}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[13px] font-semibold text-foreground bg-secondary px-2.5 py-1 rounded-full inline-block mb-1">
                      {member.role}
                    </div>
                    <div className="text-xs text-muted-foreground block capitalize">
                      {member.status || "Active"}
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
