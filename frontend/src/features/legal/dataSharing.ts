import type { DataSharingOut } from '~/api/client';

/** Whether an annotator lets us publish the annotations they create in a campaign.
 *  Taken from the API rather than restated, so the two cannot drift. */
export type DataSharingChoice = DataSharingOut['choice'];

export const DATA_SHARING_OPTIONS: {
  value: DataSharingChoice;
  label: string;
  description: string;
}[] = [
  {
    value: 'none',
    label: 'Keep private',
    description: 'Your annotations stay within this campaign.',
  },
  {
    value: 'anonymous',
    label: 'Share without my name',
    description: 'They may be published as research data, with no name attached.',
  },
  {
    value: 'attributed',
    label: 'Share with my name',
    description: 'They may be published as research data, credited to your display name.',
  },
];
