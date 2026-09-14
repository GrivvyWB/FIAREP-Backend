import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useSubmitPublicResidentReport, useLookupPublicResidentReports, getLookupPublicResidentReportsQueryKey } from '@workspace/api-client-react';
import { ArrowLeft } from 'lucide-react';

const reportSchema = z.object({
  development: z.string().min(1, 'Development is required'),
  address: z.string().optional(),
  unit: z.string().optional(),
  description: z.string().min(1, 'Description is required'),
  reporterName: z.string().optional(),
  reporterPhone: z.string().optional(),
  reporterEmail: z.string().email('Invalid email').optional().or(z.literal('')),
});

const lookupSchema = z.object({
  complaintNo: z.string().min(1, 'Complaint number is required'),
});

export default function PublicResident() {
  const [view, setView] = useState<'options' | 'submit' | 'lookup'>('options');
  const [lookupData, setLookupData] = useState<{ complaintNo: string } | null>(null);
  
  const { toast } = useToast();
  
  const submitReport = useSubmitPublicResidentReport();
  
  const { data: statusResult, isLoading: isLookingUp, error: lookupError } = useLookupPublicResidentReports(
    lookupData?.complaintNo || '',
    { query: { enabled: !!lookupData, retry: false, queryKey: getLookupPublicResidentReportsQueryKey(lookupData?.complaintNo || '') } }
  );

  useEffect(() => {
    if (statusResult) {
       setView('lookup');
    }
  }, [statusResult]);
  
  const reportForm = useForm<z.infer<typeof reportSchema>>({
    resolver: zodResolver(reportSchema),
    defaultValues: { development: '', address: '', unit: '', description: '', reporterName: '', reporterPhone: '', reporterEmail: '' },
  });

  const lookupForm = useForm<z.infer<typeof lookupSchema>>({
    resolver: zodResolver(lookupSchema),
    defaultValues: { 
      complaintNo: sessionStorage.getItem('fiarep_resident_complaint') || '', 
    },
  });

  const onReportSubmit = (values: z.infer<typeof reportSchema>) => {
    submitReport.mutate({
      data: {
        id: crypto.randomUUID(),
        state: values
      }
    }, {
      onSuccess: (res) => {
        const returnedComplaintNo = (res.state as any)?.complaintNo || res.id;
        
        sessionStorage.setItem('fiarep_resident_complaint', returnedComplaintNo);
        sessionStorage.setItem('fiarep_resident_token', res.statusToken);
        
        toast({
          title: 'Report Submitted',
          description: `Your complaint number is ${returnedComplaintNo}. Keep this for your records.`,
        });
        
        lookupForm.setValue('complaintNo', returnedComplaintNo);
        setView('options');
        reportForm.reset();
      },
      onError: (err: any) => {
        toast({ variant: 'destructive', title: 'Submission Failed', description: err.message || 'Could not submit report.' });
      }
    });
  };

  const onLookupSubmit = (values: z.infer<typeof lookupSchema>) => {
    setLookupData(null);
    setTimeout(() => setLookupData(values), 0);
  };

  return (
    <div className="min-h-screen bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-xl mx-auto">
        <div className="mb-8">
          {view !== 'options' && (
             <button onClick={() => { setView('options'); setLookupData(null); }} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 cursor-pointer bg-transparent border-none">
               <ArrowLeft className="w-4 h-4 mr-2" />
               Back
             </button>
          )}
          <div className="flex justify-center mb-6">
            <div className="font-bold text-3xl tracking-tight">
              FIA<span className="text-[#F5B301]">REP</span> Resident
            </div>
          </div>
        </div>

        {view === 'options' && (
          <div className="space-y-6">
            <Card className="hover:border-primary transition-colors cursor-pointer shadow-md" onClick={() => setView('submit')}>
              <CardHeader>
                <CardTitle>Submit a Report</CardTitle>
              </CardHeader>
            </Card>

            <Card className="hover:border-primary transition-colors shadow-md">
              <CardHeader>
                <CardTitle>Check Report Status</CardTitle>
              </CardHeader>
              <CardContent>
                <Form {...lookupForm}>
                  <form onSubmit={lookupForm.handleSubmit(onLookupSubmit)} className="space-y-4">
                    <FormField control={lookupForm.control} name="complaintNo" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Complaint Number</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <Button type="submit" className="w-full" disabled={isLookingUp}>
                      {isLookingUp ? 'Checking...' : 'Check Status'}
                    </Button>
                  </form>
                </Form>
                {lookupError && (
                  <div className="mt-4 p-3 bg-destructive/10 text-destructive text-sm rounded-md border border-destructive/20">
                    {(lookupError as any)?.message || 'Report not found.'}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {view === 'submit' && (
          <Card className="shadow-lg border-border/50">
            <CardHeader>
              <CardTitle>Submit a Report</CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...reportForm}>
                <form onSubmit={reportForm.handleSubmit(onReportSubmit)} className="space-y-4">
                  <FormField control={reportForm.control} name="development" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Development</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                   <FormField control={reportForm.control} name="address" render={({ field }) => (
                     <FormItem>
                       <FormLabel>Address (Optional)</FormLabel>
                       <FormControl><Input {...field} /></FormControl>
                       <FormMessage />
                     </FormItem>
                   )} />
                  <FormField control={reportForm.control} name="unit" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unit (Optional)</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={reportForm.control} name="description" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl><Textarea className="min-h-[100px]" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={reportForm.control} name="reporterName" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Your Name (Optional)</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={reportForm.control} name="reporterPhone" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone Number (Optional)</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={reportForm.control} name="reporterEmail" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Address (Optional)</FormLabel>
                      <FormControl><Input type="email" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" className="w-full" disabled={submitReport.isPending}>
                    {submitReport.isPending ? 'Submitting...' : 'Submit Report'}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}

        {view === 'lookup' && statusResult && (
          <Card className="shadow-lg border-border/50">
            <CardHeader>
              <CardTitle>Report Status</CardTitle>
              <CardDescription>Complaint No: {statusResult.complaintNo}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-1">Status</h4>
                <div className="text-lg font-semibold uppercase tracking-wide text-primary">
                  {statusResult.status}
                </div>
              </div>
              
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-1">Description</h4>
                <p className="text-sm bg-muted/30 p-3 rounded-md border border-border/50">
                  {statusResult.description}
                </p>
              </div>

              {statusResult.updates && statusResult.updates.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3">Updates</h4>
                  <div className="space-y-4">
                    {statusResult.updates.map((update, idx) => (
                      <div key={idx} className="border-l-2 border-primary pl-3 py-1">
                        <div className="text-xs text-muted-foreground mb-1">
                          {update.timestamp ? new Date(update.timestamp as string).toLocaleString() : 'Update'}
                        </div>
                        <div className="text-sm">{update.note as string}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
