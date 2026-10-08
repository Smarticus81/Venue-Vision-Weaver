import { useMemo } from "react";
import { getGetPublicConfigQueryKey, useGetPublicConfig, type PublicConfig } from "@workspace/api-client-react";
import { DEFAULT_PUBLIC_CONFIG, parsePublicConfig, readPublicConfigFromDocument } from "./publicConfig";

/**
 * Published prices and trial terms: the HTML shell's meta tag first (no
 * fetch, real prices on first paint), then GET /public/config, then the
 * launch defaults. The dashboard never hardcodes a price.
 */
export function usePublicConfig(): PublicConfig {
  const fromMeta = useMemo(() => readPublicConfigFromDocument(), []);
  const query = useGetPublicConfig({
    query: { queryKey: getGetPublicConfigQueryKey(), enabled: fromMeta === null, staleTime: 60_000, retry: 1 },
  });
  return useMemo(() => {
    if (fromMeta) return fromMeta;
    const parsed = query.data ? parsePublicConfig(query.data) : null;
    return parsed ?? DEFAULT_PUBLIC_CONFIG;
  }, [fromMeta, query.data]);
}
