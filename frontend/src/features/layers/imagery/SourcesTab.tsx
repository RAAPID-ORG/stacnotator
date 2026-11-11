import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { IconCheck, IconPlus, IconSettings } from '~/shared/ui/Icons';
import type { ImageryController } from './controller';
import { sourceRegistration } from './controller';
import { AddSourceWizard, type WizardStep } from './AddSourceWizard';
import { SourceEditor } from './SourceEditor';
import { describeExpiry, expiresSoon, sourceAccessExpiry } from './sasToken';

interface SourcesTabProps {
  controller: ImageryController;
}

/** A source opened for editing; `createdBy` is the wizard step that just made it,
 *  which is where Back returns to. */
interface Editing {
  id: string;
  createdBy?: WizardStep;
}

export const SourcesTab = ({ controller }: SourcesTabProps) => {
  const { t } = useTranslation('imagery');
  const [wizard, setWizard] = useState<WizardStep | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const editingSource = editing
    ? (controller.state.sources.find((s) => s.id === editing.id) ?? null)
    : null;
  const createdBy = editing?.createdBy;

  const sources = controller.state.sources;
  const expiring = sources.flatMap((source) => {
    const expiry = sourceAccessExpiry(source);
    return expiry && expiresSoon(expiry) ? [{ source, expiry }] : [];
  });

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {sources.map((source) => {
          const registration = sourceRegistration(source, controller.campaignId);
          return (
            <button
              key={source.id}
              type="button"
              onClick={() => setEditing({ id: source.id })}
              title={
                registration
                  ? t('sources.configureProgress', {
                      registered: registration.registered,
                      total: registration.total,
                    })
                  : t('sources.configure')
              }
              className="group relative flex items-center justify-center rounded-lg border-2 transition-all cursor-pointer px-4 py-3 shrink-0 border-neutral-200 bg-white text-neutral-800 hover:border-brand-400 hover:bg-brand-700/10"
            >
              <IconSettings className="absolute inset-0 m-auto w-4 h-4 transition-opacity opacity-0 group-hover:opacity-100 text-brand-600" />
              <span className="text-xs font-medium leading-tight truncate max-w-[120px] transition-opacity group-hover:opacity-0">
                {source.name || t('untitled')}
              </span>
              {registration && (
                <span
                  data-testid="source-registration-progress"
                  data-registered={registration.registered}
                  data-total={registration.total}
                  className="absolute top-1 right-1 transition-opacity group-hover:opacity-0"
                >
                  {registration.complete ? (
                    <IconCheck className="w-3 h-3 text-green-700" />
                  ) : (
                    <span className="text-[9px] font-medium text-amber-600">
                      {registration.percent}%
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setWizard({ kind: 'pick-preset' })}
          className="flex items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 hover:border-brand-400 hover:bg-brand-50/30 transition-all cursor-pointer px-4 py-3 shrink-0"
        >
          <IconPlus className="w-4 h-4 text-neutral-400" />
          <span className="text-[11px] text-neutral-500 ml-1">{t('sources.create')}</span>
        </button>
      </div>

      {expiring.length > 0 && (
        <div
          className="mt-3 space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800"
          data-testid="sas-expiry-warning"
        >
          {expiring.map(({ source, expiry }) => (
            <p key={source.id}>
              <Trans
                t={t}
                i18nKey="sources.sasExpiryWarning"
                values={{ name: source.name || t('untitled'), expiry: describeExpiry(expiry) }}
                components={{ strong: <strong /> }}
              />
            </p>
          ))}
        </div>
      )}

      {wizard && (
        <AddSourceWizard
          controller={controller}
          initialStep={wizard}
          onClose={() => setWizard(null)}
          onCreated={(id, step) => {
            setWizard(null);
            setEditing({ id, createdBy: step });
          }}
        />
      )}

      {editingSource && (
        <SourceEditor
          source={editingSource}
          controller={controller}
          onClose={() => setEditing(null)}
          onBack={
            createdBy
              ? () => {
                  setEditing(null);
                  void controller.removeSource(editingSource.id).then(() => setWizard(createdBy));
                }
              : undefined
          }
        />
      )}
    </>
  );
};
