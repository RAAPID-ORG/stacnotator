import { InfoPopover } from '~/shared/ui/InfoPopover';
import { SecretInput, SecretStatus } from '~/shared/ui/SecretInput';
import { describeExpiry, expiresSoon, readSasToken } from './sasToken';

interface SasTokenFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/** A SAS token for a catalog in private Azure storage, checked as it is typed. Write-only:
 *  it is encrypted on the server, used only to read that catalog, and never shown again. */
export const SasTokenField = ({
  value,
  onChange,
  placeholder = 'sv=...&sp=r&se=...&sig=...',
}: SasTokenFieldProps) => {
  const reading = value.trim() ? readSasToken(value) : null;
  const status =
    reading === null ? undefined : 'error' in reading ? (
      <SecretStatus tone="error">Not accepted</SecretStatus>
    ) : (
      <SecretStatus tone={expiresSoon(reading.expiresAt) ? 'warn' : 'ok'}>Read-only ✓</SecretStatus>
    );
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-neutral-700">SAS token</span>
        <InfoPopover>
          A read-only SAS token for the container (or folder) holding the catalog. It is encrypted
          on the server, used only to read this catalog and its imagery, and never sent to
          annotators. When it expires, replace it in the source settings.
        </InfoPopover>
      </div>
      <SecretInput
        aria-label="SAS token"
        masked={false}
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
    </div>
  );
};
