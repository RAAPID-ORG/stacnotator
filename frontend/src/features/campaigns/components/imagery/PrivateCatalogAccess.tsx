import { useState } from 'react';
import type { ImageryController } from './controller';
import {
  describeExpiry,
  expiresSoon,
  privateCollections,
  readSasToken,
  sourceAccessExpiry,
} from './sasToken';
import { SasTokenField } from './SasTokenField';
import type { ImagerySource } from './types';

/** When a source reads a private catalog: when its SAS token expires, and a way to replace
 *  it. The replacement goes out with the next save, for every collection of that catalog. */
export const PrivateCatalogAccess = ({
  source,
  controller,
}: {
  source: ImagerySource;
  controller: ImageryController;
}) => {
  const [value, setValue] = useState('');
  const collections = privateCollections(source);
  if (collections.length === 0) return null;
  const expiry = sourceAccessExpiry(source);

  const replace = (next: string) => {
    setValue(next);
    const reading = next.trim() ? readSasToken(next) : null;
    const token = reading && 'token' in reading ? reading.token : undefined;
    for (const collection of collections) {
      void controller.updateCollection(source.id, collection.id, {
        data: { ...collection.data, sasToken: token },
      });
    }
  };

  return (
    <div className="space-y-1" data-testid="private-catalog-access">
      <SasTokenField
        value={value}
        onChange={replace}
        placeholder="Paste a new token to replace it"
      />
      {expiry && !value.trim() && (
        <p className={`text-[11px] ${expiresSoon(expiry) ? 'text-amber-600' : 'text-neutral-500'}`}>
          Current token {describeExpiry(expiry)}
        </p>
      )}
    </div>
  );
};
