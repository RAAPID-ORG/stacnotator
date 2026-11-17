import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '~/shared/ui/Tooltip';

export interface PlanRow {
  key: string;
  label: string;
  slices: string[];
  cover: string;
}

interface PlanPreviewProps {
  rows: PlanRow[];
  summary: string;
  help?: string;
  action: ReactNode;
}

export const PlanPreview = ({ rows, summary, help, action }: PlanPreviewProps) => {
  const { t } = useTranslation('imagery');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className="space-y-2">
      {rows.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-xs font-medium text-neutral-700">
            {t('preview.title')}
            {help && <Tooltip text={help} />}
            <span className="ml-auto text-[11px] font-normal text-neutral-500">{summary}</span>
          </div>
          <div className="max-h-36 overflow-y-auto grid grid-cols-2 items-start gap-1.5">
            {rows.map((row) => {
              const expanded = open.has(row.key);
              return (
                <div
                  key={row.key}
                  className="rounded-md border border-neutral-200 bg-neutral-50/60 text-[11px]"
                >
                  <button
                    type="button"
                    onClick={() => toggle(row.key)}
                    aria-expanded={expanded}
                    className="w-full text-left px-2 py-1 cursor-pointer hover:bg-neutral-100 rounded-md"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="text-neutral-400 w-2">{expanded ? '▾' : '▸'}</span>
                      <span className="font-medium text-neutral-800 truncate">{row.label}</span>
                      <span className="ml-auto text-neutral-600 tabular-nums shrink-0">
                        {t('planet.slices', { count: row.slices.length })}
                      </span>
                    </span>
                    <span className="block pl-3.5 text-neutral-500 truncate" title={row.cover}>
                      {t('preview.cover', { cover: row.cover })}
                    </span>
                  </button>
                  {expanded && (
                    <div className="flex flex-wrap gap-1 px-2 pb-1.5 pl-5">
                      {row.slices.map((slice, i) => (
                        <span
                          key={`${slice}-${i}`}
                          className="rounded bg-white border border-neutral-200 px-1 text-neutral-600"
                        >
                          {slice}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex justify-end">{action}</div>
    </div>
  );
};
