import type { QueryClient, QueryKey } from "@tanstack/react-query";
import {
  getGetEntityRecordQueryKey,
  getGetCurrentStaffQueryKey,
  getGetScoresQueryKey,
  getListEntityRecordsQueryKey,
  getListStaffDevelopmentsQueryKey,
  getListStaffQueryKey,
  getListNotificationsQueryKey,
} from "@workspace/api-client-react";

/**
 * Entity records are shown in several surfaces (the entity page, dashboard,
 * calendar, activity, and scores). Invalidate by the generated list prefix so
 * filtered variants are refreshed as well, then invalidate the generated
 * detail key when a record is known.
 */
export async function invalidateOperationalQueries(
  queryClient: QueryClient,
  entity: string,
  id?: string,
  relatedEntities: string[] = [],
) {
  const keys: QueryKey[] = [
    getListEntityRecordsQueryKey(entity),
    ...relatedEntities.map((relatedEntity) => getListEntityRecordsQueryKey(relatedEntity)),
    getListNotificationsQueryKey(),
    getGetScoresQueryKey(),
  ];
  if (id) keys.push(getGetEntityRecordQueryKey(entity, id));
  await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

export async function invalidateStaffQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: getListStaffQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getListStaffDevelopmentsQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getGetCurrentStaffQueryKey() }),
  ]);
}
