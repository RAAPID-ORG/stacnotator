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
  const reading = value.trim() ? readSasToken(value) : null;
  const status =
    reading === null ? (
      configured ? (
        <SecretStatus tone={expiresSoon(expiresAt) ? 'warn' : 'ok'}>Saved ✓</SecretStatus>
      ) : undefined
    ) : 'error' in reading ? (
      <SecretStatus tone="error">Not accepted</SecretStatus>
    ) : (
      <SecretStatus tone={expiresSoon(reading.expiresAt) ? 'warn' : 'ok'}>Read-only ✓</SecretStatus>
    );
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-neutral-700">SAS token</span>
        <InfoPopover>
          A read-only SAS token for the container holding this data. It is encrypted on the server,
          used only to read this storage host, and never sent to annotators. When it expires,
          replace it in the layer settings. Paste the token here, not into the data URL.
        </InfoPopover>
      </div>
      <SecretInput
        aria-label="SAS token"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        status={status}
      />
      {reading && 'error' in reading && <p className="text-[11px] text-red-600">{reading.error}</p>}
      {reading && 'expiresAt' in reading && (
        <p className="text-[11px] text-neutral-500">
          Read-only access, {describeExpiry(reading.expiresAt)}
        </p>
      )}
      {configured && expiresAt && !reading && (
        <p
          className={`text-[11px] ${expiresSoon(expiresAt) ? 'text-amber-600' : 'text-neutral-500'}`}
        >
          Current token {describeExpiry(expiresAt)}
        </p>
      )}
    </div>
  );
};
