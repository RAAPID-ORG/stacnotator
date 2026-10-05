import { Input } from '~/shared/ui/forms';
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
  return (
    <div className="space-y-1">
      <Input
        size="sm"
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        aria-label="SAS token"
        className="text-[11px] font-mono"
      />
      {reading && 'error' in reading && <p className="text-[11px] text-red-600">{reading.error}</p>}
      {reading && 'expiresAt' in reading && (
        <p
          className={`text-[11px] ${expiresSoon(reading.expiresAt) ? 'text-amber-600' : 'text-emerald-600'}`}
        >
          Read-only access, {describeExpiry(reading.expiresAt)}
        </p>
      )}
      <p className="text-[11px] text-neutral-500 leading-snug">
        A read-only SAS token for the container (or folder) holding the catalog. It is encrypted on
        the server, used only to read this catalog and its imagery, and never sent to annotators.
        When it expires, replace it in the source settings.
      </p>
    </div>
  );
};
