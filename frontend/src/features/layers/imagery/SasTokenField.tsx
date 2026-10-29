import { useTranslation } from 'react-i18next';
import { InfoPopover } from '~/shared/ui/InfoPopover';
import { SecretInput, SecretStatus } from '~/shared/ui/SecretInput';
import { describeExpiry, expiresSoon, readSasToken } from './sasToken';

interface SasTokenFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  expiresAt?: string | null;
  configured?: boolean;
}

/** A write-only SAS token for private Azure storage, checked as it is typed. */
export const SasTokenField = ({
  value,
  onChange,
  placeholder = 'sv=...&sp=r&se=...&sig=...',
  expiresAt,
  configured = false,
}: SasTokenFieldProps) => {
  const { t } = useTranslation('imagery');
  const reading = value.trim() ? readSasToken(value) : null;
  const status =
    reading === null ? (
      configured ? (
        <SecretStatus tone={expiresSoon(expiresAt) ? 'warn' : 'ok'}>{t('keys.saved')}</SecretStatus>
      ) : undefined
    ) : 'error' in reading ? (
      <SecretStatus tone="error">{t('sasToken.notAccepted')}</SecretStatus>
    ) : (
      <SecretStatus tone={expiresSoon(reading.expiresAt) ? 'warn' : 'ok'}>
        {t('sasToken.readOnly')}
      </SecretStatus>
    );
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-neutral-700">{t('sasToken.label')}</span>
        <InfoPopover>{t('sasToken.explainer')}</InfoPopover>
      </div>
      <SecretInput
        aria-label={t('sasToken.label')}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        status={status}
      />
      {reading && 'error' in reading && <p className="text-[11px] text-red-600">{reading.error}</p>}
      {reading && 'expiresAt' in reading && (
        <p className="text-[11px] text-neutral-500">
          {t('sasToken.readOnlyAccess', { expiry: describeExpiry(reading.expiresAt) })}
        </p>
      )}
      {configured && expiresAt && !reading && (
        <p
          className={`text-[11px] ${expiresSoon(expiresAt) ? 'text-amber-600' : 'text-neutral-500'}`}
        >
          {t('sasToken.currentToken', { expiry: describeExpiry(expiresAt) })}
        </p>
      )}
    </div>
  );
};
