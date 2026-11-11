import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarButton } from './BarButton';
import { IconChevronLeft, IconChevronRight } from './Icons';

export type TabItem<T extends string = string> = {
  id: T;
  label: React.ReactNode;
  disabled?: boolean;
};

interface TabNavigatorProps<T extends string> {
  items: TabItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
  className?: string;
  size?: 'default' | 'bar';
  label?: string;
  panelId?: string;
}

export function TabNavigator<T extends string = string>({
  items,
  activeId,
  onChange,
  className,
  size = 'default',
  label,
  panelId,
}: TabNavigatorProps<T>) {
  const { t } = useTranslation('common');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ visible: false, left: false, right: false });

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const container = containerRef.current;
    if (size !== 'bar' || !wrapper || !container) return;
    const measure = () => {
      const next = {
        visible: container.scrollWidth > wrapper.clientWidth + 1,
        left: container.scrollLeft > 1,
        right: container.scrollLeft + container.clientWidth < container.scrollWidth - 1,
      };
      setOverflow((previous) =>
        previous.visible === next.visible &&
        previous.left === next.left &&
        previous.right === next.right
          ? previous
          : next
      );
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(wrapper);
    observer?.observe(container);
    for (const child of container.children) observer?.observe(child);
    container.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => {
      observer?.disconnect();
      container.removeEventListener('scroll', measure);
    };
  }, [items, size]);

  useEffect(() => {
    if (size !== 'bar') return;
    const container = containerRef.current;
    const selected = container?.querySelector('[aria-selected="true"]');
    if (!container || !selected) return;
    const outer = container.getBoundingClientRect();
    const tab = selected.getBoundingClientRect();
    if (tab.left < outer.left) container.scrollLeft += tab.left - outer.left;
    else if (tab.right > outer.right) container.scrollLeft += tab.right - outer.right;
  }, [activeId, items.length, size, overflow.visible]);

  const scroll = (direction: number) => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollBy({
      left: direction * container.clientWidth * 0.75,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  };

  const tabs = (
    <div
      ref={containerRef}
      role="tablist"
      aria-label={label}
      className={`flex ${
        size === 'bar'
          ? 'min-w-0 flex-1 overflow-x-auto gap-1 [scrollbar-width:none]'
          : 'gap-4 mb-3 border-b border-neutral-300'
      } ${className ?? ''}`}
    >
      {items.map((item) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={activeId === item.id}
          id={panelId ? `${panelId}-tab-${item.id}` : undefined}
          aria-controls={panelId ?? `tab-${item.id}`}
          tabIndex={activeId === item.id ? 0 : -1}
          onClick={() => !item.disabled && onChange(item.id)}
          onKeyDown={(event) => {
            const enabled = items.filter((tab) => !tab.disabled);
            const index = enabled.findIndex((tab) => tab.id === item.id);
            const next =
              event.key === 'ArrowRight'
                ? enabled[(index + 1) % enabled.length]
                : event.key === 'ArrowLeft'
                  ? enabled[(index - 1 + enabled.length) % enabled.length]
                  : event.key === 'Home'
                    ? enabled[0]
                    : event.key === 'End'
                      ? enabled.at(-1)
                      : undefined;
            if (!next) return;
            event.preventDefault();
            const buttons =
              containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
            buttons?.[items.findIndex((tab) => tab.id === next.id)]?.focus();
            onChange(next.id);
          }}
          className={`${size === 'bar' ? 'h-11 shrink-0 px-3 text-[13px] whitespace-nowrap' : 'px-4 py-3'} border-b-2 transition-colors cursor-pointer focus-visible:bg-neutral-100 ${
            activeId === item.id
              ? 'border-brand-600 text-brand-700 font-medium'
              : 'border-transparent text-neutral-500 hover:text-brand-700'
          } ${item.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
          type="button"
          disabled={item.disabled}
        >
          {item.label}
        </button>
      ))}
    </div>
  );

  if (size !== 'bar') return tabs;
  return (
    <div ref={wrapperRef} className="flex min-w-0 flex-1 items-center">
      {overflow.visible && (
        <BarButton
          icon={IconChevronLeft}
          aria-label={t('tabs.scrollLeft')}
          title={t('tabs.scrollLeft')}
          disabled={!overflow.left}
          onClick={() => scroll(-1)}
        />
      )}
      {tabs}
      {overflow.visible && (
        <BarButton
          icon={IconChevronRight}
          aria-label={t('tabs.scrollRight')}
          title={t('tabs.scrollRight')}
          disabled={!overflow.right}
          onClick={() => scroll(1)}
        />
      )}
    </div>
  );
}
