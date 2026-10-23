import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '~/shared/i18n';
import { IconChevronDown, IconGlobe } from './Icons';

export const LanguageSelect = ({ className = '' }: { className?: string }) => {
  const { t, i18n } = useTranslation();

  return (
    <label
      className={`relative inline-flex items-center gap-1.5 h-7 pl-2 pr-1.5 rounded-md text-[11px] text-neutral-500 cursor-pointer transition-colors hover:text-neutral-900 hover:bg-neutral-100 focus-within:ring-2 focus-within:ring-brand-600/30 ${className}`}
    >
      <IconGlobe className="w-3.5 h-3.5 shrink-0" />
      <select
        value={i18n.resolvedLanguage}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
        aria-label={t('language')}
        className="appearance-none bg-transparent pr-4 cursor-pointer focus:outline-none"
      >
        {LANGUAGES.map((language) => (
          <option key={language.code} value={language.code} lang={language.code}>
            {language.label}
          </option>
        ))}
      </select>
      <IconChevronDown className="pointer-events-none absolute right-1.5 w-3 h-3" />
    </label>
  );
};
