import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
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
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { REGEXP_ONLY_DIGITS_AND_CHARS } from "input-otp";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const loginSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  code: z
    .string()
    .length(4, "Code must be exactly 4 characters")
    .regex(/^[a-zA-Z0-9]+$/, "Code can only contain letters and numbers"),
});

export default function Login() {
  const [location, setLocation] = useLocation();
  const { login, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated && location === "/login") {
      const returnTo = sessionStorage.getItem("fiarep_return_to");
      sessionStorage.removeItem("fiarep_return_to");
      setLocation(returnTo?.startsWith("/") && returnTo !== "/login" ? returnTo : "/dashboard");
    }
  }, [isAuthenticated, location, setLocation]);

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      name: "",
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
      const returnTo = sessionStorage.getItem("fiarep_return_to");
      sessionStorage.removeItem("fiarep_return_to");
      setLocation(returnTo?.startsWith("/") && returnTo !== "/login" ? returnTo : "/dashboard");
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Login Failed",
        description: err?.message || "Invalid credentials. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center mb-6">
          <div className="font-bold text-4xl tracking-tight">
            FIA<span className="text-[#F5B301]">REP</span>
          </div>
        </div>
        <h2 className="mt-2 text-center text-2xl font-extrabold text-foreground tracking-tight">
          Sign in to your account
        </h2>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Field Inspection and Repair Estimation Platform
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-card py-8 px-4 shadow-sm sm:rounded-xl sm:px-10 border border-border">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input placeholder="John Smith" {...field} data-testid="input-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Access Code</FormLabel>
                    <FormControl>
                      <div className="flex justify-center">
                        <InputOTP
                          maxLength={4}
                          pattern={REGEXP_ONLY_DIGITS_AND_CHARS}
                          autoComplete="one-time-code"
                          {...field}
                          data-testid="input-otp-code"
                        >
                          <InputOTPGroup>
                            <InputOTPSlot index={0} />
                            <InputOTPSlot index={1} />
                            <InputOTPSlot index={2} />
                            <InputOTPSlot index={3} />
                          </InputOTPGroup>
                        </InputOTP>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full font-semibold" disabled={isSubmitting} data-testid="button-submit-login">
                {isSubmitting ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </Form>
        </div>
      </div>
    </div>
  );
}
