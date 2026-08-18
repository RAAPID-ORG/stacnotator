import { useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CampaignOutFull } from '~/api/client';
import { useDismissOnOutside } from '~/shared/hooks/useDismissOnOutside';
import { Dropdown } from '~/shared/ui/motion';
import { IconBook, IconClose } from '~/shared/ui/Icons';
import { useHotkeys, type Binding } from '../../hotkeys';

export function GuidePanel({ campaign }: { campaign: CampaignOutFull }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const bindings = useMemo<Binding[]>(
    () => [{ key: 'g', help: 'Campaign guide', run: () => setOpen((o) => !o) }],
    []
  );
  useHotkeys(bindings, []);
  useDismissOnOutside(containerRef, () => setOpen(false), open);

  return (
    <div ref={containerRef} className="relative" data-tour="campaign-guide">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center justify-center w-8 h-8 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded transition-colors ${open ? 'bg-neutral-100' : ''}`}
        title="Campaign guide (G)"
        data-testid="guide-toggle"
      >
        <IconBook className="w-5 h-5" />
      </button>
      <Dropdown open={open} className="absolute top-full right-0 mt-1 z-20 origin-top-right">
        <div
          className="bg-white border border-neutral-200 rounded-lg shadow-lg w-[420px] max-h-[70vh] flex flex-col"
          data-testid="guide-panel"
        >
          <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-neutral-100">
            <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
              Campaign guide
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-neutral-400 hover:text-neutral-600"
              title="Close"
            >
              <IconClose className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="overflow-y-auto px-4 py-3">
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['html']}>
                {campaign.settings.guide_markdown || 'No guide available for this campaign.'}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      </Dropdown>
    </div>
  );
}
