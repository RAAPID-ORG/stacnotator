import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '~/shared/i18n';

export const LanguageSelect = ({ className = '' }: { className?: string }) => {
  const { t, i18n } = useTranslation();

  return (
    <select
      value={i18n.resolvedLanguage}
      onChange={(e) => i18n.changeLanguage(e.target.value)}
      aria-label={t('language')}
      title={t('language')}
      className={`bg-transparent cursor-pointer focus:outline-none hover:text-neutral-700 transition-colors ${className}`}
    >
      {LANGUAGES.map((language) => (
        <option key={language.code} value={language.code} lang={language.code}>
          {language.label}
        </option>
      ))}
    </select>
  );
};
