import { useTranslation } from 'react-i18next';

export interface PasswordRequirement {
  id: 'minLength' | 'uppercase' | 'lowercase' | 'number' | 'special';
  test: (password: string) => boolean;
}

export const PASSWORD_REQUIREMENTS: PasswordRequirement[] = [
  { id: 'minLength', test: (p) => p.length >= 8 },
  { id: 'uppercase', test: (p) => /[A-Z]/.test(p) },
  { id: 'lowercase', test: (p) => /[a-z]/.test(p) },
  { id: 'number', test: (p) => /[0-9]/.test(p) },
  { id: 'special', test: (p) => /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(p) },
];

export function passwordMeetsAllRequirements(password: string): boolean {
  return PASSWORD_REQUIREMENTS.every((req) => req.test(password));
}

export function PasswordRequirementIndicator({
  requirement,
  password,
}: {
  requirement: PasswordRequirement;
  password: string;
}) {
  const { t } = useTranslation('auth');
  const met = password.length > 0 && requirement.test(password);
  const partial = password.length > 0 && !met;

  return (
    <div className="flex items-center gap-2 text-xs">
      <div
        className={`w-4 h-4 rounded-full flex items-center justify-center ${
          met ? 'bg-brand-600' : partial ? 'bg-neutral-300' : 'bg-neutral-200'
        }`}
      >
        {met && (
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <span className={met ? 'text-brand-700' : 'text-neutral-600'}>
        {t(`passwordRequirements.${requirement.id}`)}
      </span>
    </div>
  );
}

export function PasswordRequirementsList({ password }: { password: string }) {
  const { t } = useTranslation('auth');
  if (password.length === 0) return null;

  return (
    <div className="mt-3 p-3 bg-neutral-50 rounded border border-neutral-200">
      <p className="text-xs font-medium text-brand-700 mb-2">{t('passwordRequirements.title')}</p>
      <div className="space-y-1.5">
        {PASSWORD_REQUIREMENTS.map((req, idx) => (
          <PasswordRequirementIndicator key={idx} requirement={req} password={password} />
        ))}
      </div>
    </div>
  );
}
