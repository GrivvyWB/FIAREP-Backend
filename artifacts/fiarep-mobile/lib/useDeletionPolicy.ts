import { useEffect, useState } from 'react';
import { getDeletionPolicy } from './store';

/**
 * Returns whether tenant-data deletion controls may be shown for the current
 * authenticated staff session. Loading and failed policy requests are
 * intentionally deny-by-default.
 */
export function useDeletionPolicy(active = true): boolean {
  const [canDelete, setCanDelete] = useState(false);

  useEffect(() => {
    let mounted = true;
    setCanDelete(false);
    if (!active) return () => { mounted = false; };

    getDeletionPolicy()
      .then((policy) => {
        if (mounted) setCanDelete(policy.enabled === true && policy.canDelete === true);
      })
      .catch(() => {
        if (mounted) setCanDelete(false);
      });

    return () => { mounted = false; };
  }, [active]);

  return canDelete;
}