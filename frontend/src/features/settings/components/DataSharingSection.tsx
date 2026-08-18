import { useEffect, useState } from 'react';
import { listMyDataSharing, setDataSharing, type DataSharingOut } from '~/api/client';
import { DATA_SHARING_OPTIONS, type DataSharingChoice } from '~/features/legal/dataSharing';
import { legalPath } from '~/features/legal/docs';
import { Select } from '~/shared/ui/forms';
import { handleError } from '~/shared/utils/errorHandler';

const isChoice = (value: string): value is DataSharingChoice =>
  DATA_SHARING_OPTIONS.some((option) => option.value === value);

/** Every research-sharing answer this user has given, in one place, because the
 *  terms promise they can review and change them here. */
export const DataSharingSection = () => {
  const [rows, setRows] = useState<DataSharingOut[] | null>(null);
  const [saving, setSaving] = useState<number | null>(null);

  useEffect(() => {
    listMyDataSharing({ throwOnError: true })
      .then(({ data }) => setRows(data))
      .catch((error) => {
        handleError(error, 'Failed to load your data sharing choices');
        setRows([]);
      });
  }, []);

  const change = async (campaignId: number, choice: DataSharingChoice) => {
    setSaving(campaignId);
    try {
      await setDataSharing({ path: { campaign_id: campaignId }, body: { choice } });
      setRows(
        (current) =>
          current?.map((row) => (row.campaign_id === campaignId ? { ...row, choice } : row)) ?? null
      );
    } catch (error) {
      handleError(error, 'Could not save your choice');
    } finally {
      setSaving(null);
    }
  };

  if (rows !== null && rows.length === 0) return null;

  return (
    <section className="space-y-4 pt-6 mt-6 border-t border-neutral-100">
      <h2 className="section-heading">Research data sharing</h2>

      <p className="text-sm text-neutral-600 mb-4">
        Whether the annotations you created in a campaign may be published as research data. A
        change applies from now on - see{' '}
        <a href={legalPath('terms')} className="underline hover:text-brand-700">
          the Terms of Service
        </a>
        .
      </p>

      <div className="space-y-2 max-w-xl">
        {(rows ?? []).map((row) => (
          <div
            key={row.campaign_id}
            className="flex items-center justify-between gap-4 rounded-lg border border-neutral-200 px-3 py-2"
          >
            <span className="text-sm text-neutral-900 truncate">{row.campaign_name}</span>
            <Select
              size="sm"
              className="w-56 shrink-0"
              value={row.choice}
              disabled={saving === row.campaign_id}
              onChange={(e) => {
                if (isChoice(e.target.value)) change(row.campaign_id, e.target.value);
              }}
            >
              {DATA_SHARING_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        ))}
      </div>
    </section>
  );
};
