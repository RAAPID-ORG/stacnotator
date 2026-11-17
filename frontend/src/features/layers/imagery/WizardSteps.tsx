import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

interface WizardStep {
  label: string;
  onClick?: () => void;
}

interface WizardStepsProps {
  steps: WizardStep[];
  current: number;
  onBack?: () => void;
}

export const WizardSteps = ({ steps, current, onBack }: WizardStepsProps) => {
  const { t } = useTranslation('imagery');
  return (
    <div className="flex items-center gap-1 text-[11px] leading-4 text-neutral-400">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mr-2 text-neutral-500 hover:text-neutral-700 cursor-pointer"
        >
          {t('wizard.back')}
        </button>
      )}
      {steps.map((step, i) => {
        const className = i === current ? 'text-brand-600 font-medium' : '';
        return (
          <Fragment key={step.label}>
            {i > 0 && <span>/</span>}
            {step.onClick ? (
              <button
                type="button"
                onClick={step.onClick}
                className={`cursor-pointer hover:text-neutral-600 ${className}`}
              >
                {step.label}
              </button>
            ) : (
              <span className={className}>{step.label}</span>
            )}
          </Fragment>
        );
      })}
    </div>
  );
};
