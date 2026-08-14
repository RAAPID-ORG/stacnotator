interface ReadOnlyKeyConsentProps {
  confirmed: boolean;
  onChange: (value: boolean) => void;
}

/**
 * Least-privilege gate on entering a provider key by hand.
 *
 * A stored key is used to fetch imagery tiles and nothing else, so a read-only one is
 * always enough. Making that an explicit confirmation rather than a line of advice is
 * the point: whoever pastes the key is the only one who can check what it can do.
 *
 * Shown wherever a key can be typed - the campaign imagery editors, the Planet wizard,
 * and the organization's shared keys.
 */
export const ReadOnlyKeyConsent = ({ confirmed, onChange }: ReadOnlyKeyConsentProps) => (
  <label className="flex items-start gap-1.5 text-[11px] text-neutral-600 leading-snug">
    <input
      type="checkbox"
      checked={confirmed}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-0.5"
    />
    <span>
      This key is <strong>read-only</strong> and scoped to the least access it needs. Only provide
      keys with the minimum privileges required to read imagery.
    </span>
  </label>
);
