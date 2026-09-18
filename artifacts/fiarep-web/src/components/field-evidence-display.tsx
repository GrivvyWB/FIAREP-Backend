import { MapPin, Image as ImageIcon, Map as MapIcon, Clock, Navigation, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { requestFileDownloadUrl, requestResidentReportPhotoDownload } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

interface FieldEvidenceDisplayProps {
  state: Record<string, any>;
  reportId?: string; // If it's a resident report and we need to fetch photo IDs using useListResidentReportPhotos? 
  // wait, resident reports are handled differently in the photos section of reports page. But the prompt says:
  // "Integrate it into the existing generic entity details so emergency and repair records get it, and into resident reports, elevators, and inspections where those pages bypass generic details."
}

export function FieldEvidenceDisplay({ state, reportId }: FieldEvidenceDisplayProps) {
  // Extract all useful timestamps
  const primaryTimestamps = [
    { label: "Arrival / En Route", value: state.arrivalAt || state.startedAt || state.onMyWayAt },
    { label: "Started", value: state.startAt || state.startedAt },
    { label: "Completed / Resolved", value: state.completedAt || state.resolvedAt },
  ].filter(t => t.value); // we will render these if truthy
  const usedTimestampValues = new Set(primaryTimestamps.map((item) => String(item.value)));
  const otherTimestamps = Object.entries(state)
    .filter(([key, value]) => (
      key.endsWith("At") &&
      typeof value === "string" &&
      !usedTimestampValues.has(value) &&
      !Number.isNaN(new Date(value).getTime())
    ))
    .map(([key, value]) => ({
      label: key
        .replace(/At$/, "")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^./, (letter) => letter.toUpperCase()),
      value,
    }));
  const timestamps = [...primaryTimestamps, ...otherTimestamps];

  // Extract geo
  const arrivalGeo = state.arrivalGeo;
  const completionGeo = state.completionGeo;
  
  // Extract remote files
  const remoteFiles = Array.isArray(state.remoteFiles) ? state.remoteFiles : [];
  
  // Create a map to lookup metadata for remote files (using localUri or objectPath)
  const metaByPath = new Map<string, any>();
  const evidenceArrays = [
    ...(Array.isArray(state.photoEvidence) ? state.photoEvidence : []),
    ...(Array.isArray(state.completionPhotoEvidence) ? state.completionPhotoEvidence : [])
  ];
  
  for (const ev of evidenceArrays) {
    if (ev.uri) metaByPath.set(ev.uri, ev);
  }

  // Combine photos
  const photos = remoteFiles.filter(f => f.objectPath).map(f => {
    const meta = metaByPath.get(f.localUri) || metaByPath.get(f.objectPath);
    return {
      id: f.id || f.objectPath, // fallback to objectPath if no id
      objectPath: f.objectPath,
      name: f.name || "Photo Evidence",
      capturedAt: f.capturedAt || meta?.capturedAt,
      geo: f.geo || meta?.geo,
    };
  });
  
  // Some legacy data might just have `photos` or `completionPhotos` array of strings
  const stringPhotos = [
    ...(Array.isArray(state.photos) ? state.photos : []),
    ...(Array.isArray(state.completionPhotos) ? state.completionPhotos : [])
  ].filter(p => typeof p === 'string' && (p.startsWith('http') || p.startsWith('/objects/')));

  for (const p of stringPhotos) {
    if (!photos.some(existing => existing.objectPath === p || existing.id === p)) {
      const meta = metaByPath.get(p);
      photos.push({
        id: p,
        objectPath: p,
        name: "Photo Evidence",
        capturedAt: meta?.capturedAt,
        geo: meta?.geo,
      });
    }
  }

  // If there's literally no field evidence to show, we hide the section (or return null)
  if (!timestamps.length && !arrivalGeo && !completionGeo && !photos.length) {
    return null;
  }

  return (
    <div className="space-y-4 pt-2">
      <h3 className="font-semibold text-sm border-b pb-2">Field Evidence</h3>
      
      {timestamps.length > 0 && (
        <div className="grid grid-cols-2 gap-3 text-sm">
          {timestamps.map((t, i) => (
            <div key={i}>
              <span className="text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" /> {t.label}
              </span>
              <p className="font-medium mt-0.5">
                {new Date(t.value as string).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}

      {(arrivalGeo || completionGeo) && (
        <div className="grid grid-cols-2 gap-3 text-sm border-t pt-3">
          {arrivalGeo && <GeoDisplay label="Arrival Location" geo={arrivalGeo} />}
          {completionGeo && <GeoDisplay label="Completion Location" geo={completionGeo} />}
        </div>
      )}

      {photos.length > 0 && (
        <div className="border-t pt-3">
          <p className="text-sm text-muted-foreground mb-2 flex items-center gap-1">
            <ImageIcon className="w-3 h-3" /> Photos
          </p>
          <div className="grid grid-cols-2 gap-3">
            {photos.map((photo, i) => (
              <PhotoDisplay key={i} photo={photo} isResidentReport={!!reportId} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GeoDisplay({ label, geo }: { label: string, geo: any }) {
  if (!geo || !geo.at) return null;
  
  const hasCoordinates = typeof geo.lat === 'number' && typeof geo.lng === 'number';
  
  return (
    <div>
      <span className="text-muted-foreground flex items-center gap-1">
        <MapPin className="w-3 h-3" /> {label}
      </span>
      <div className="mt-0.5 space-y-0.5">
        {hasCoordinates ? (
          <>
            <p className="font-medium flex items-center gap-1">
              {geo.lat.toFixed(5)}, {geo.lng.toFixed(5)}
              <a 
                href={`https://maps.google.com/?q=${geo.lat},${geo.lng}`} 
                target="_blank" 
                rel="noreferrer"
                className="text-primary hover:underline ml-1 flex items-center"
              >
                <MapIcon className="w-3 h-3" />
              </a>
            </p>
            {geo.accuracy && <p className="text-xs text-muted-foreground">Accuracy: {geo.accuracy.toFixed(1)}m</p>}
          </>
        ) : (
          <p className="font-medium text-muted-foreground flex items-center gap-1 text-xs">
            <AlertCircle className="w-3 h-3" /> GPS Unavailable
          </p>
        )}
        <p className="text-xs text-muted-foreground">{new Date(geo.at).toLocaleString()}</p>
      </div>
    </div>
  );
}

function PhotoDisplay({ photo, isResidentReport }: { photo: any, isResidentReport: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    // If it's a direct HTTP url, just use it
    if (photo.objectPath?.startsWith('http')) {
      setUrl(photo.objectPath);
      return;
    }
    
    let cancelled = false;
    
    async function fetchUrl() {
      if (!photo.objectPath && !photo.id) return;
      
      setLoading(true);
      try {
        let downloadUrl = '';
        if (isResidentReport && photo.id) {
          // Resident report photos usually use the specific endpoint
          // But wait! Resident report photos shown in `remoteFiles` are added by staff updates.
          // Staff uploads them via standard file upload endpoint, meaning they are standard files!
          // So we should just use requestFileDownloadUrl for them, since they have an objectPath!
          // If they don't have objectPath, they are probably resident-submitted. But resident-submitted ones
          // are handled by the <Photos reportId={...} /> component in reports.tsx! 
          // So actually, all photos here will use requestFileDownloadUrl.
        }
        
        // Always use generic file download if it has an objectPath
        if (photo.objectPath?.startsWith('/objects/')) {
          const res = await requestFileDownloadUrl({ objectPath: photo.objectPath });
          downloadUrl = res.downloadUrl;
        } else if (photo.objectPath) {
          // It might just be the direct path or we need to prefix it, but the API requires `/objects/...`
          // Let's just try requestFileDownloadUrl
          const res = await requestFileDownloadUrl({ objectPath: photo.objectPath });
          downloadUrl = res.downloadUrl;
        }
        
        if (!cancelled && downloadUrl) {
          setUrl(downloadUrl);
        }
      } catch (err) {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    
    fetchUrl();
    
    return () => {
      cancelled = true;
    };
  }, [photo.objectPath, photo.id, isResidentReport]);

  const handleOpen = () => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button 
        type="button" 
        className="block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary" 
        onClick={handleOpen} 
        disabled={loading || !url}
      >
        {url && !error ? (
          <img
            src={url}
            alt={photo.name}
            className="h-32 w-full bg-muted object-cover"
            onError={() => setError(true)}
          />
        ) : (
          <div className="grid h-32 place-items-center bg-muted text-muted-foreground">
            {loading ? (
              <span className="text-xs">Loading...</span>
            ) : (
              <ImageIcon className="h-6 w-6 opacity-40" />
            )}
          </div>
        )}
      </button>
      <div className="p-2 bg-muted/30">
        <p className="text-xs font-medium truncate">{photo.name}</p>
        {photo.capturedAt && (
          <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(photo.capturedAt).toLocaleString()}</p>
        )}
        {photo.geo && typeof photo.geo.lat === 'number' && (
          <p className="text-[10px] text-muted-foreground flex items-center gap-0.5 mt-0.5 truncate">
            <Navigation className="w-2.5 h-2.5" />
            {photo.geo.lat.toFixed(4)}, {photo.geo.lng.toFixed(4)}
          </p>
        )}
      </div>
    </div>
  );
}
