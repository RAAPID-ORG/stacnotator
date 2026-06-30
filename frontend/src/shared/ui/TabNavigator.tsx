import React from 'react';

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
}

export function TabNavigator<T extends string = string>({
  items,
  activeId,
  onChange,
  className,
}: TabNavigatorProps<T>) {
  return (
    <div
      role="tablist"
      className={`flex gap-4 mb-3 border-b border-neutral-300 ${className ?? ''}`}
    >
      {items.map((item) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={activeId === item.id}
          aria-controls={`tab-${item.id}`}
          onClick={() => !item.disabled && onChange(item.id)}
          className={`px-4 py-3 border-b-2 transition-colors cursor-pointer ${
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
}

export default TabNavigator;
