import type { ProjectId } from "@synara/contracts";
import { queryOptions } from "@tanstack/react-query";

import { ensureNativeApi } from "~/nativeApi";

export const githubReferenceQueryKeys = {
  search: (projectId: ProjectId | null, query: string) =>
    ["github-references", "search", projectId, query] as const,
};

export function githubReferenceSearchQueryOptions(input: {
  projectId: ProjectId | null;
  query: string;
  enabled: boolean;
}) {
  return queryOptions({
    queryKey: githubReferenceQueryKeys.search(input.projectId, input.query),
    queryFn: () => {
      if (!input.projectId) throw new Error("GitHub reference search requires a project.");
      return ensureNativeApi().githubReferences.search({
        projectId: input.projectId,
        query: input.query,
        limit: 20,
      });
    },
    enabled: input.enabled && input.projectId !== null,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
