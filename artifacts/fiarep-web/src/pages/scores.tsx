import { useGetScores, getGetScoresQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Loader2, Target, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function getScoreBadgeVariant(score: number) {
  if (score >= 90) return "default";
  if (score >= 70) return "secondary";
  return "destructive";
}

export default function Scores() {
  const { data: scores, isLoading, isError, refetch, isRefetching } = useGetScores({
    query: {
      queryKey: getGetScoresQueryKey(),
      refetchInterval: 300_000, // Refresh every 5 minutes
      staleTime: 60_000,
    },
  });

  const handleRefresh = () => {
    refetch();
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-[50vh] items-center justify-center space-y-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Scores & Performance</h1>
          </div>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            Failed to load performance scores. Please check your connection and try again.
          </AlertDescription>
        </Alert>
        <Button onClick={() => refetch()} variant="outline" className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }

  if (!scores) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <p className="text-muted-foreground text-sm">No score data available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Target className="h-6 w-6 text-primary" />
            Scores & Performance
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">Last Updated</p>
            <p className="text-sm font-medium">
              {format(new Date(scores.generatedAt), "MMM d, yyyy HH:mm")}
            </p>
          </div>
          <Button 
            onClick={handleRefresh} 
            variant="outline" 
            size="sm"
            disabled={isRefetching}
            className="gap-2 shrink-0"
          >
            <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader className="border-b border-border/40 bg-muted/20 pb-4">
            <CardTitle className="text-lg">Development Performance</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {scores.developments.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No development data available.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/10">
                    <TableRow>
                      <TableHead>Development</TableHead>
                      <TableHead className="text-right">Points</TableHead>
                      <TableHead className="text-right">Open / Overdue</TableHead>
                      <TableHead className="text-right">Completed</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scores.developments.map((dev) => (
                      <TableRow key={dev.development}>
                        <TableCell className="font-medium">{dev.development}</TableCell>
                        <TableCell className="text-right">{dev.points}</TableCell>
                        <TableCell className="text-right">
                          <span className="text-muted-foreground">{dev.open}</span>
                          <span className="mx-1 text-border">/</span>
                          <span className={dev.overdue > 0 ? "text-destructive font-medium" : "text-muted-foreground"}>
                            {dev.overdue}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">{dev.completed}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={getScoreBadgeVariant(dev.scorePercent)} className="ml-auto w-12 justify-center">
                            {dev.scorePercent}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="border-b border-border/40 bg-muted/20 pb-4">
            <CardTitle className="text-lg">Vendor Reliability</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {scores.vendors.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No vendor data available.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/10">
                    <TableRow>
                      <TableHead>Vendor</TableHead>
                      <TableHead className="text-right">Completed</TableHead>
                      <TableHead className="text-right">Deductions</TableHead>
                      <TableHead className="text-right">On-Time Rate</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scores.vendors.map((vendor) => (
                      <TableRow key={vendor.vendor}>
                        <TableCell className="font-medium">{vendor.vendor}</TableCell>
                        <TableCell className="text-right">{vendor.completed}</TableCell>
                        <TableCell className="text-right">
                          <span className={vendor.deductions > 0 ? "text-amber-600 font-medium" : "text-muted-foreground"}>
                            {vendor.deductions}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatPercent(vendor.onTimeRate)}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={getScoreBadgeVariant(vendor.score)} className="ml-auto w-12 justify-center">
                            {vendor.score}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="border-b border-border/40 bg-muted/20 pb-4">
            <CardTitle className="text-lg">Building Status</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {scores.buildings.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No building data available.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/10">
                    <TableRow>
                      <TableHead>Building</TableHead>
                      <TableHead className="text-right">Total / Resolved</TableHead>
                      <TableHead className="text-right">Open / Overdue</TableHead>
                      <TableHead className="text-right">Resolution Rate</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scores.buildings.map((bldg) => (
                      <TableRow key={bldg.building}>
                        <TableCell className="font-medium">{bldg.building}</TableCell>
                        <TableCell className="text-right">
                          <span className="text-muted-foreground">{bldg.total}</span>
                          <span className="mx-1 text-border">/</span>
                          <span className="text-foreground">{bldg.resolved}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-muted-foreground">{bldg.open}</span>
                          <span className="mx-1 text-border">/</span>
                          <span className={bldg.overdue > 0 ? "text-destructive font-medium" : "text-muted-foreground"}>
                            {bldg.overdue}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatPercent(bldg.resolutionRate)}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={getScoreBadgeVariant(bldg.score)} className="ml-auto w-12 justify-center">
                            {bldg.score}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="border-b border-border/40 bg-muted/20 pb-4">
            <CardTitle className="text-lg">Residential Scores</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {scores.residential.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No residential data available.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/10">
                    <TableRow>
                      <TableHead>Address</TableHead>
                      <TableHead className="text-right">Total / Resolved</TableHead>
                      <TableHead className="text-right">Open / Overdue</TableHead>
                      <TableHead className="text-right">Resolution Rate</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scores.residential.map((res) => (
                      <TableRow key={res.address}>
                        <TableCell className="font-medium">{res.address}</TableCell>
                        <TableCell className="text-right">
                          <span className="text-muted-foreground">{res.total}</span>
                          <span className="mx-1 text-border">/</span>
                          <span className="text-foreground">{res.resolved}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-muted-foreground">{res.open}</span>
                          <span className="mx-1 text-border">/</span>
                          <span className={res.overdue > 0 ? "text-destructive font-medium" : "text-muted-foreground"}>
                            {res.overdue}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatPercent(res.resolutionRate)}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={getScoreBadgeVariant(res.score)} className="ml-auto w-12 justify-center">
                            {res.score}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
