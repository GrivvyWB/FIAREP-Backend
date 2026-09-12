import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateEntityRecord } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { invalidateOperationalQueries } from "@/lib/query-invalidation";

const schema = z.object({
  title: z.string().min(1, "Title is required"),
  development: z.string().min(1, "Development name/ID is required"),
  description: z.string().optional(),
});

export default function NewInspection() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createRecord = useCreateEntityRecord();

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      development: "",
      description: "",
    },
  });

  const onSubmit = async (values: z.infer<typeof schema>) => {
    try {
      const id = crypto.randomUUID();
      await createRecord.mutateAsync({
        entity: "inspections",
        data: {
          id,
          development: values.development,
          state: {
            title: values.title,
            description: values.description,
            status: "pending",
          },
          version: 1,
        }
      });
      
      toast({ title: "Success", description: "Inspection created successfully." });
       await invalidateOperationalQueries(queryClient, "inspections", id);
      setLocation("/inspections");
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: err?.message || "Failed to create inspection.",
      });
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/inspections">
          <Button variant="outline" size="icon" className="shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Inspection</h1>
          <p className="text-muted-foreground text-sm">Create a new field assessment record.</p>
        </div>
      </div>

      <div className="bg-card rounded-[14px] shadow-sm border border-border p-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Inspection Title</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Annual HVAC Assessment" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="development"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Development / Location</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Sunset Apartments" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Add any initial notes or context here..." 
                      className="resize-none min-h-[120px]"
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-3 pt-4 border-t border-border">
              <Link href="/inspections">
                <Button variant="ghost" type="button">Cancel</Button>
              </Link>
              <Button type="submit" disabled={createRecord.isPending} data-testid="button-create-inspection">
                {createRecord.isPending ? "Creating..." : "Create Inspection"}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
