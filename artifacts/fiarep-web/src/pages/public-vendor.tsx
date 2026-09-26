import { ScopeLines, ViolationCode } from "@/components/scope-lines";
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
  const [progressNote, setProgressNote] = useState('');
  const [progressBusy, setProgressBusy] = useState(false);
  const [checkedInAt, setCheckedInAt] = useState<string | null>(null);
  // Walk-through check-in from the phone's browser: GPS + time go to
  // Procurement, who see whether the vendor was at the building.
  function walkthroughCheckIn() {
    if (!lookupData) return;
    if (!('geolocation' in navigator)) { toast({ variant: 'destructive', title: 'Location unavailable', description: 'Use a phone with location turned on.' }); return; }
    setProgressBusy(true);
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const capturedAt = new Date(position.timestamp || Date.now()).toISOString();
        const response = await fetch(`/api/v1/public/vendor-scopes/${encodeURIComponent(lookupData.trackingId)}/walkthrough-check-ins`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
            vendorName: lookupData.vendorName,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            capturedAt,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || 'Check-in failed');
        setCheckedInAt(capturedAt);
        toast({ title: 'Checked in', description: 'Your arrival time and location were sent to Procurement.' });
      } catch (error: any) {
        toast({ variant: 'destructive', title: 'Check-in failed', description: error?.message });
      } finally {
        setProgressBusy(false);
      }
    }, () => {
      setProgressBusy(false);
      toast({ variant: 'destructive', title: 'Location required', description: 'Allow location access to check in at the walk-through.' });
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }
  // Awarded vendor reports Start / Complete; Procurement, the CPM and the CPM
  // Supervisor are notified.
  async function reportProgress(step: 'start' | 'complete') {
    if (!lookupData) return;
    setProgressBusy(true);
    try {
      const response = await fetch(`/api/v1/public/vendor-scopes/${encodeURIComponent(lookupData.trackingId)}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendorName: lookupData.vendorName, step, note: progressNote.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Could not update the job');
      setProgressNote('');
      queryClient.invalidateQueries({ queryKey: getLookupPublicVendorScopeQueryKey(lookupData.trackingId, { vendorName: lookupData.vendorName }) });
      toast({ title: step === 'start' ? 'Marked as started' : 'Marked complete', description: 'Procurement has been notified.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Update failed', description: error?.message });
    } finally {
      setProgressBusy(false);
    }
  }
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
                {!!((scopeResult.state as any)?.sourceRef || (scopeResult.state as any)?.complaintNo || (scopeResult.state as any)?.violationNo) && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">Reference</h4>
                    <p className="text-sm font-semibold">{(scopeResult.state as any)?.sourceRef || (scopeResult.state as any)?.complaintNo || (scopeResult.state as any)?.violationNo}</p>
                  </div>
                )}
                <div>
                  <ViolationCode state={(scopeResult.state as any) || {}} />
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">Address</h4>
                  <p className="text-sm">{(scopeResult.state as any)?.address || 'N/A'}</p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">Scope of Work</h4>
                  <div className="text-sm whitespace-pre-wrap bg-muted/30 p-3 rounded-md border border-border/50">
                    {(scopeResult.state as any)?.scope || 'No scope details provided.'}
                  </div>
                  {/* The CPM's scope lines with section codes — enter your own pricing. */}
                  <div className="mt-3"><ScopeLines scope={(scopeResult.state as any)?.vendorScopeTemplate} showPrices={false} /></div>
                </div>
                {((scopeResult.state as any)?.walkthroughAt || (scopeResult.state as any)?.bidCloseAt) && (
                   <div className="grid grid-cols-2 gap-4 pt-2">
                     {(scopeResult.state as any)?.walkthroughAt && (
                       <div>
                         <h4 className="text-sm font-medium text-muted-foreground mb-1">Walkthrough</h4>
                         <p className="text-sm font-semibold">{(scopeResult.state as any).walkthroughAt}</p>
                         {!!(scopeResult.state as any)?.walkthroughNote && <p className="text-sm mt-1">{(scopeResult.state as any).walkthroughNote}</p>}
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

            {!!(scopeResult.state as any)?.walkthroughAt && ['bidding', 'awarded'].includes((scopeResult.state as any)?.status) && (
              <Card className="shadow-lg border-border/50">
                <CardHeader><CardTitle>Walk-through check-in</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm text-muted-foreground">When you arrive at the building for the walk-through ({(scopeResult.state as any).walkthroughAt}), check in so Procurement has your arrival time.</p>
                  {checkedInAt ? (
                    <p className="text-sm font-medium">Checked in {new Date(checkedInAt).toLocaleString()}</p>
                  ) : (
                    <Button className="w-full" disabled={progressBusy} onClick={walkthroughCheckIn}>I'm at the building — check in</Button>
                  )}
                </CardContent>
              </Card>
            )}
            {(scopeResult.state as any)?.status === 'awarded' && !(scopeResult.state as any)?.completedAt && (
              <Card className="shadow-lg border-border/50">
                <CardHeader><CardTitle>Your awarded job</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {!!(scopeResult.state as any)?.startedAt && <p className="text-sm text-muted-foreground">Started {new Date((scopeResult.state as any).startedAt).toLocaleString()}</p>}
                  {!(scopeResult.state as any)?.startedAt ? (
                    <Button className="w-full" disabled={progressBusy} onClick={() => reportProgress('start')}>Start work</Button>
                  ) : (
                    <>
                      <Input value={progressNote} onChange={(e) => setProgressNote(e.target.value)} placeholder="Completion note (optional)" />
                      <Button className="w-full" disabled={progressBusy} onClick={() => reportProgress('complete')}>Mark work complete</Button>
                    </>
                  )}
                </CardContent>
              </Card>
            )}
            {!!(scopeResult.state as any)?.completedAt && (scopeResult.state as any)?.status === 'awarded' && (
              <p className="text-sm text-muted-foreground">Completed {new Date((scopeResult.state as any).completedAt).toLocaleString()} — Procurement will rate and close the job.</p>
            )}
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
