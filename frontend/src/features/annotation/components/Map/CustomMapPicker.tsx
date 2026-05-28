import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOverlayStore } from '../../stores/overlay.store';

export default function CustomMapPicker() {
  const customMaps = useOverlayStore((s) => s.customMaps);
  const activeId = useOverlayStore((s) => s.activeId);
  const setActive = useOverlayStore((s) => s.setActive);

  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const scheduleClose = useCallback(() => {
    closeTimerRef.current = setTimeout(() => setOpen(false), 80);
  }, []);
  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);
  const toggle = useCallback(() => {
    cancelClose();
    setOpen((o) => !o);
  }, [cancelClose]);

  useEffect(() => {
    if (!open || !buttonRef.current || !dropdownRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    dropdownRef.current.style.top = `${rect.bottom + 4}px`;
    dropdownRef.current.style.left = `${rect.left}px`;
  }, [open]);

  if (customMaps.length === 0) return null;

  const active = activeId ? customMaps.find((m) => m.id === activeId) : null;

  const handleSelect = (id: string | null) => {
    setActive(id);
    setOpen(false);
  };

  return (
    <div className="select-none" onMouseLeave={scheduleClose} onMouseEnter={cancelClose}>
      <button
        ref={buttonRef}
        onClick={toggle}
        className={`h-6 px-1.5 text-[11px] font-medium rounded-md transition-colors flex items-center gap-1.5 cursor-pointer ${
          active
            ? 'text-brand-700 bg-brand-50 hover:bg-brand-100'
            : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
        }`}
        title="Custom maps (M cycles)"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="opacity-70 shrink-0"
        >
          <path
            d="M3 7l7-4 7 4M3 13l7 4 7-4M3 10l7 4 7-4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
        <span className="truncate max-w-[10rem]">{active ? active.name : 'Maps'}</span>
      </button>

      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999]"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <div className="bg-white border border-neutral-200 rounded-lg shadow-lg min-w-[220px] max-h-[300px] overflow-y-auto">
              <div className="px-3 py-1.5 text-[11px] font-semibold text-neutral-500 tracking-wide bg-neutral-50 border-b border-neutral-200">
                Custom maps
              </div>
              <label
                className={`flex items-center px-3 py-2 text-xs cursor-pointer transition-colors hover:bg-neutral-50 ${
                  activeId === null ? 'bg-brand-50 text-brand-700' : 'text-neutral-800'
                }`}
              >
                <input
                  type="radio"
                  name="custom-map"
                  checked={activeId === null}
                  onChange={() => handleSelect(null)}
                  className="mr-2 accent-brand-500"
                />
                <span className="italic text-neutral-500">None</span>
              </label>
              {customMaps.map((m) => {
                const ready = m.status === 'ready';
                return (
                  <label
                    key={m.id}
                    className={`flex items-center px-3 py-2 text-xs transition-colors hover:bg-neutral-50 ${
                      ready ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
                    } ${activeId === m.id ? 'bg-brand-50 text-brand-700' : 'text-neutral-800'}`}
                    title={
                      m.status === 'failed'
                        ? (m.error_message ?? 'Processing failed')
                        : m.status !== 'ready'
                          ? `Status: ${m.status}`
                          : undefined
                    }
                  >
                    <input
                      type="radio"
                      name="custom-map"
                      checked={activeId === m.id}
                      disabled={!ready}
                      onChange={() => handleSelect(m.id)}
                      className="mr-2 accent-brand-500"
                    />
                    <span className="flex-1 truncate">{m.name}</span>
                    {!ready && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-neutral-400">
                        {m.status}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
