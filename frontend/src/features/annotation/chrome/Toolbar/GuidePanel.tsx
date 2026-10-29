import { useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useTranslation } from 'react-i18next';
import remarkGfm from 'remark-gfm';
import type { CampaignOutFull } from '~/api/client';
import { useDismissOnOutside } from '~/shared/hooks/useDismissOnOutside';
import { Dropdown } from '~/shared/ui/motion';
import { BarButton } from '~/shared/ui/BarButton';
import { IconBook, IconClose } from '~/shared/ui/Icons';
import { useHotkeys, type Binding } from '../../hotkeys';

export function GuidePanel({ campaign }: { campaign: CampaignOutFull }) {
  const { t } = useTranslation(['annotation', 'common']);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const bindings = useMemo<Binding[]>(
    () => [{ key: 'g', help: t('guide.title'), run: () => setOpen((o) => !o) }],
    [t]
  );
  useHotkeys(bindings, [bindings]);
  useDismissOnOutside(containerRef, () => setOpen(false), open);

  return (
    <div ref={containerRef} className="relative" data-tour="campaign-guide">
      <BarButton
        icon={IconBook}
        active={open}
        onClick={() => setOpen((o) => !o)}
        title={t('guide.toggleTip')}
        aria-label={t('guide.toggleTip')}
        data-testid="guide-toggle"
      />
      <Dropdown open={open} className="absolute top-full right-0 mt-1 z-20 origin-top-right">
        <div
          className="bg-white border border-neutral-200 rounded-lg shadow-lg w-[420px] max-h-[70vh] flex flex-col"
          data-testid="guide-panel"
        >
          <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-neutral-100">
            <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              {t('guide.title')}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-neutral-400 hover:text-neutral-600"
              title={t('common:actions.close')}
            >
              <IconClose className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="overflow-y-auto px-4 py-3">
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['html']}>
                {campaign.settings.guide_markdown || t('guide.empty')}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      </Dropdown>
    </div>
  );
}
