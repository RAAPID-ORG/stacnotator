import { Trans, useTranslation } from 'react-i18next';
import { InfoPopover } from '~/shared/ui/InfoPopover';

interface ReadOnlyKeyConsentProps {
  confirmed: boolean;
  onChange: (value: boolean) => void;
}

/**
 * Least-privilege gate on entering a provider key by hand.
 *
 * A stored key is used to fetch imagery tiles and nothing else, so a read-only one is
 * always enough. Making that an explicit confirmation rather than a line of advice is
 * the point: whoever pastes the key is the only one who can check what it can do. It
 * sits directly under the key it is about, once there is a key to confirm.
 *
 * Shown wherever a key can be typed - the imagery key fields, the Planet wizards, and
 * the organization's shared keys.
 */
export const ReadOnlyKeyConsent = ({ confirmed, onChange }: ReadOnlyKeyConsentProps) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-neutral-600">
      <label className="flex items-center gap-1.5 cursor-pointer">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onChange(e.target.checked)}
          className="accent-brand-600"
        />
        <Trans
          t={t}
          i18nKey="readOnlyKey.confirm"
          components={{ strong: <strong className="font-medium" /> }}
        />
      </label>
      <InfoPopover>{t('readOnlyKey.info')}</InfoPopover>
    </div>
  );
};
