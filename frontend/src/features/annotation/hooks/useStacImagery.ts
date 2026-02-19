import { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { stacRegistrationLimiter } from '~/shared/utils/rateLimiter';

interface UseStacImageryParams {
  registrationUrl: string;
  searchBody: Record<string, unknown>;
  bbox: [number, number, number, number]; // [west, south, east, north]
  startDate: string;
  endDate: string;
  visualizationUrlTemplates: Array<{ id: number; name: string; visualization_url: string }>;
  enabled?: boolean;
}

interface UseStacImageryResult {
  tileUrls: Array<{ id: number; name: string; url: string }>;
  loading: boolean;
  error: string | null;
}

/**
 * Custom hook to register with STAC service and generate tile URLs
 */
export const useStacImagery = ({
  registrationUrl,
  searchBody,
  bbox,
  startDate,
  endDate,
  visualizationUrlTemplates,
  enabled = true,
}: UseStacImageryParams): UseStacImageryResult => {
  const [tileUrls, setTileUrls] = useState<Array<{ id: number; name: string; url: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Memoize dependency values to prevent unnecessary re-runs
  const bboxKey = useMemo(() => bbox.join(','), [bbox]);
  const searchBodyKey = useMemo(() => JSON.stringify(searchBody), [searchBody]);
  const templatesKey = useMemo(
    () => JSON.stringify(visualizationUrlTemplates),
    [visualizationUrlTemplates]
  );

  useEffect(() => {
    if (!enabled || !registrationUrl) {
      return;
    }

    let cancelled = false;

    const registerAndFetchTileUrls = async () => {
      try {
        setLoading(true);
        setError(null);

        // Prepare the registration payload
        const registrationPayload = {
          ...searchBody,
          bbox,
        };

        // Replace date placeholders in the search body
        const payloadString = JSON.stringify(registrationPayload);
        const replacedPayload = payloadString
          .replace(/\{startDatetimePlaceholder\}/g, startDate)
          .replace(/\{endDatetimePlaceholder\}/g, endDate);

        const finalPayload = JSON.parse(replacedPayload);

        // Call the STAC registration endpoint with rate limiting
        const response = await stacRegistrationLimiter.execute(async () => {
          return await axios.post(registrationUrl, finalPayload);
        });

        if (cancelled) return;

        const searchId =
          response.data?.searchId || response.data?.searchid || response.data?.search_id;

        if (!searchId) {
          throw new Error('No searchId returned from registration endpoint');
        }

        // Generate tile URLs by replacing {searchId} placeholder
        const urls = visualizationUrlTemplates.map((template) => ({
          id: template.id,
          name: template.name,
          url: template.visualization_url.replace(/\{searchId\}/g, searchId),
        }));

        if (cancelled) return;
        setTileUrls(urls);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to register imagery';
        setError(message);
        console.error('STAC registration error:', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    registerAndFetchTileUrls();

    return () => {
      cancelled = true;
    };
  }, [registrationUrl, searchBodyKey, bboxKey, startDate, endDate, templatesKey, enabled]);

  return { tileUrls, loading, error };
};
