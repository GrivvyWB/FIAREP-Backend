import { CalendarDays } from "lucide-react";

export default function Calendar() {
  return (
    <div className="space-y-6 h-full flex flex-col">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
        <p className="text-muted-foreground text-sm">Date-organized operational records.</p>
      </div>

      <div className="bg-card rounded-[14px] shadow-sm border border-border flex-1 flex flex-col items-center justify-center min-h-[400px]">
        <CalendarDays className="w-16 h-16 text-muted-foreground/20 mb-4" />
        <h3 className="text-xl font-bold">Calendar View</h3>
        <p className="text-muted-foreground text-sm mt-2 max-w-sm text-center">
          The calendar view is currently being implemented. Check back later for date-organized operational records.
        </p>
      </div>
    </div>
  );
}
