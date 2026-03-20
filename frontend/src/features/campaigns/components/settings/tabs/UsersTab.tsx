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
  return (
    <div id="tab-users" role="tabpanel">
      <CampaignUsersSection campaignId={campaignId} onError={onError} onSuccess={onSuccess} />
    </div>
  );
};

export default UsersTab;
