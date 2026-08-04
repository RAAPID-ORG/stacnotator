import React from 'react';
import { CampaignUsersSection } from '~/features/campaigns/components/settings/CampaignUsersSection';
import type { CampaignUserOut } from '~/api/client';

interface Props {
  campaignId: number;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  campaignUsers: CampaignUserOut[];
}

export const UsersTab: React.FC<Props> = ({ campaignId, onError, onSuccess }) => {
  // pb matches the picker dropdown's max height (max-h-64) so an open list
  // near the end of the page can always be scrolled fully into view.
  return (
    <div id="tab-users" role="tabpanel" className="pb-64">
      <CampaignUsersSection campaignId={campaignId} onError={onError} onSuccess={onSuccess} />
    </div>
  );
};

export default UsersTab;
