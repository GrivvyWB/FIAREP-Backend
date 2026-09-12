import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useLookupPublicVendorScope, useSubmitPublicVendorBid, getLookupPublicVendorScopeQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

const lookupSchema = z.object({
  trackingId: z.string().min(1, 'Procurement-issued ID is required'),
  vendorName: z.string().min(1, 'Vendor name is required'),
});

const bidSchema = z.object({
  amount: z.coerce.number().min(0.01, 'Amount must be greater than 0'),
  note: z.string().optional(),
});

export default function PublicVendor() {
  const [lookupData, setLookupData] = useState<{ trackingId: string, vendorName: string } | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: scopeResult, isLoading: isLookingUp, error: lookupError } = useLookupPublicVendorScope(
    lookupData?.trackingId || '',
    { vendorName: lookupData?.vendorName || '' },
    { query: { enabled: !!lookupData, retry: false, queryKey: getLookupPublicVendorScopeQueryKey(lookupData?.trackingId || '', { vendorName: lookupData?.vendorName || '' }) } }
  );
  
  const submitBid = useSubmitPublicVendorBid();
  
  const lookupForm = useForm<z.infer<typeof lookupSchema>>({
    resolver: zodResolver(lookupSchema),
    defaultValues: { trackingId: '', vendorName: '' },
  });

  const bidForm = useForm<z.infer<typeof bidSchema>>({
    resolver: zodResolver(bidSchema),
    defaultValues: { amount: 0, note: '' },
  });

  const onLookupSubmit = (values: z.infer<typeof lookupSchema>) => {
    setLookupData(null); // reset to trigger new fetch if same values
    setTimeout(() => setLookupData(values), 0);
  };

  const onBidSubmit = (values: z.infer<typeof bidSchema>) => {
    if (!lookupData) return;
    submitBid.mutate({
      trackingId: lookupData.trackingId,
      data: {
        vendorName: lookupData.vendorName,
        amount: values.amount,
        note: values.note,
      }
    }, {
      onSuccess: () => {
        toast({ title: 'Bid Submitted', description: 'Your bid has been recorded.' });
        bidForm.reset();
        if (lookupData) {
          queryClient.invalidateQueries({ queryKey: getLookupPublicVendorScopeQueryKey(lookupData.trackingId, { vendorName: lookupData.vendorName }) });
        }
      },
      onError: (err: any) => {
        toast({ variant: 'destructive', title: 'Submission Failed', description: err.message || 'Could not submit bid.' });
      }
    });
  };

  return (
    <div className="min-h-screen bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-xl mx-auto">
        <div className="mb-8">
          <div className="flex justify-center mb-6">
            <div className="font-bold text-3xl tracking-tight">
              FIA<span className="text-[#F5B301]">REP</span> Vendor
            </div>
          </div>
        </div>

        {!scopeResult ? (
          <Card className="shadow-lg border-border/50">
            <CardHeader>
              <CardTitle>Look Up Job</CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...lookupForm}>
                <form onSubmit={lookupForm.handleSubmit(onLookupSubmit)} className="space-y-4">
                  <FormField control={lookupForm.control} name="vendorName" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vendor Name</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={lookupForm.control} name="trackingId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Procurement ID (Tracking ID)</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" className="w-full" disabled={isLookingUp}>
                    {isLookingUp ? 'Looking up...' : 'Find Job'}
                  </Button>
                </form>
              </Form>

              {lookupError && (
                <div className="mt-4 p-3 bg-destructive/10 text-destructive text-sm rounded-md border border-destructive/20">
                  {(lookupError as any)?.message || 'Job not found or access denied.'}
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <Card className="shadow-lg border-border/50">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Job Scope</CardTitle>
                  <CardDescription>Tracking ID: {lookupData?.trackingId}</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => {
                  setLookupData(null);
                  bidForm.reset();
                }}>Change Job</Button>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">Address</h4>
                  <p className="text-sm">{(scopeResult.state as any)?.address || 'N/A'}</p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">Scope of Work</h4>
                  <div className="text-sm whitespace-pre-wrap bg-muted/30 p-3 rounded-md border border-border/50">
                    {(scopeResult.state as any)?.scope || 'No scope details provided.'}
                  </div>
                </div>
                {((scopeResult.state as any)?.walkthroughAt || (scopeResult.state as any)?.bidCloseAt) && (
                   <div className="grid grid-cols-2 gap-4 pt-2">
                     {(scopeResult.state as any)?.walkthroughAt && (
                       <div>
                         <h4 className="text-sm font-medium text-muted-foreground mb-1">Walkthrough</h4>
                         <p className="text-sm">{(scopeResult.state as any).walkthroughAt}</p>
                       </div>
                     )}
                     {(scopeResult.state as any)?.bidCloseAt && (
                       <div>
                         <h4 className="text-sm font-medium text-muted-foreground mb-1">Bids Close</h4>
                         <p className="text-sm font-medium text-destructive">{(scopeResult.state as any).bidCloseAt}</p>
                       </div>
                     )}
                   </div>
                )}
                {((scopeResult.state as any)?.status) && (
                   <div className="pt-2">
                     <h4 className="text-sm font-medium text-muted-foreground mb-1">Status</h4>
                     <p className="text-sm uppercase tracking-wider font-semibold">{(scopeResult.state as any).status}</p>
                   </div>
                )}
              </CardContent>
            </Card>

            {((scopeResult.state as any)?.status === 'bidding' || (scopeResult.state as any)?.status === 'bidding_open' || (scopeResult.state as any)?.status === 'open') ? (
              <Card className="shadow-lg border-border/50">
                <CardHeader>
                  <CardTitle>Submit Bid</CardTitle>
                </CardHeader>
                <CardContent>
                  <Form {...bidForm}>
                    <form onSubmit={bidForm.handleSubmit(onBidSubmit)} className="space-y-4">
                      <FormField control={bidForm.control} name="amount" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bid Amount ($)</FormLabel>
                          <FormControl><Input type="number" step="0.01" min="0" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={bidForm.control} name="note" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Notes (Optional)</FormLabel>
                          <FormControl><Input {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <Button type="submit" className="w-full" disabled={submitBid.isPending}>
                        {submitBid.isPending ? 'Submitting...' : 'Submit Bid'}
                      </Button>
                    </form>
                  </Form>
                </CardContent>
              </Card>
            ) : (
              <Card className="shadow-lg border-border/50 bg-muted/20">
                <CardContent className="pt-6 text-center text-muted-foreground">
                  This job is not currently open for bidding.
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
