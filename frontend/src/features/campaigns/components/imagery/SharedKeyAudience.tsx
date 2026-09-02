interface SharedKeyAudienceProps {
  /** Whether the owning project is platform-public. Undefined while unknown. */
  projectIsPublic?: boolean;
}

/**
 * Who ends up spending a shared organization key here.
 *
 * On a public project that is anyone with an account: they can open its campaigns,
 * and every tile they look at is fetched with this key. They never see it - the
 * server attaches it - but the organization's quota is spent on their behalf, so
 * the admin picking the key is the person who should hear about it first.
 *
 * Takes the fact rather than fetching it: this renders inside the imagery wizard,
 * which is deliberately outside the query cache.
 */
export const SharedKeyAudience = ({ projectIsPublic }: SharedKeyAudienceProps) => {
  if (!projectIsPublic) return null;

  return (
    <p className="text-[11px] text-amber-700 leading-snug" data-testid="shared-key-public-warning">
      This project is public: anyone with an account can open its campaigns, and their imagery loads
      through this key. The key stays on the server and is never shown to them, but the usage counts
      against your organization.
    </p>
  );
};
