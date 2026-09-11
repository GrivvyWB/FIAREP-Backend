import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useOwnerAuth } from "@/hooks/use-owner-auth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { useToast } from "@/hooks/use-toast";
import { ShieldAlert } from "lucide-react";

const loginSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  code: z.string().min(1, "Access passphrase is required"),
});

export default function OwnerLogin() {
  const [location, setLocation] = useLocation();
  const { login, isAuthenticated } = useOwnerAuth();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated && location === "/platform-owner/login") {
      const returnTo = sessionStorage.getItem("fiarep_owner_return_to");
      sessionStorage.removeItem("fiarep_owner_return_to");
      setLocation(returnTo?.startsWith("/platform-owner") && returnTo !== "/platform-owner/login" ? returnTo : "/platform-owner");
    }
  }, [isAuthenticated, location, setLocation]);

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      name: "FIAREP Platform Owner",
      code: "",
    },
  });

  if (isAuthenticated) {
    return null;
  }

  const onSubmit = async (values: z.infer<typeof loginSchema>) => {
    try {
      setIsSubmitting(true);
      await login(values.name, values.code);
      const returnTo = sessionStorage.getItem("fiarep_owner_return_to");
      sessionStorage.removeItem("fiarep_owner_return_to");
      setLocation(returnTo?.startsWith("/platform-owner") && returnTo !== "/platform-owner/login" ? returnTo : "/platform-owner");
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Authorization Denied",
        description: err?.message || "Invalid platform credentials.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-slate-50 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center mb-6">
          <div className="flex flex-col items-center gap-4">
            <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800 shadow-2xl">
              <ShieldAlert className="w-12 h-12 text-rose-500" />
            </div>
            <div className="font-bold text-4xl tracking-tight text-center">
              FIA<span className="text-[#F5B301]">REP</span>
            </div>
          </div>
        </div>
        <h2 className="mt-2 text-center text-2xl font-semibold text-white tracking-tight">
          Platform Control
        </h2>
        <p className="mt-2 text-center text-sm text-slate-400 max-w-xs mx-auto">
          Restricted access. This terminal is for platform licensing administration only.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-slate-900 py-8 px-4 shadow-2xl sm:rounded-2xl sm:px-10 border border-slate-800 relative overflow-hidden">
          {/* Subtle noise/texture overlay could go here */}
          
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 relative z-10">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-300">Authorized Personnel</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Owner Name" 
                        autoComplete="username"
                        {...field} 
                        className="bg-slate-950 border-slate-800 text-white placeholder:text-slate-600 focus-visible:ring-rose-500" 
                        data-testid="input-owner-name" 
                      />
                    </FormControl>
                    <FormMessage className="text-rose-400" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-300">Access Passphrase</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="current-password"
                        placeholder="Enter your private passphrase"
                        {...field}
                        className="bg-slate-950 border-slate-800 text-white placeholder:text-slate-600 focus-visible:ring-rose-500"
                        data-testid="input-owner-code"
                      />
                    </FormControl>
                    <FormMessage className="text-rose-400" />
                  </FormItem>
                )}
              />

              <Button 
                type="submit" 
                className="w-full font-bold tracking-wide bg-rose-600 hover:bg-rose-700 text-white border-0 shadow-lg shadow-rose-900/20 py-6 text-lg h-auto" 
                disabled={isSubmitting} 
                data-testid="button-submit-owner-login"
              >
                {isSubmitting ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </Form>
        </div>
      </div>
    </div>
  );
}
