import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { CustomMapState } from '~/features/annotation/hooks/useCustomMaps';

interface CustomMapsDropdownProps {
  maps: CustomMapState[];
  onSelect: (mapId: string) => void;
  onOpacityChange: (mapId: string, opacity: number) => void;
}

const CustomMapsDropdown = ({ maps, onSelect, onOpacityChange }: CustomMapsDropdownProps) => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const activeMap = maps.find((s) => s.visible && s.map.status === 'ready');

  const scheduleClose = useCallback(() => {
    closeTimerRef.current = setTimeout(() => setOpen(false), 80);
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!open || !buttonRef.current || !dropdownRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    dropdownRef.current.style.top = `${rect.bottom + 4}px`;
    dropdownRef.current.style.left = `${rect.left}px`;
  }, [open]);

  return (
    <div className="select-none" onMouseLeave={scheduleClose} onMouseEnter={cancelClose}>
      <button
        ref={buttonRef}
        onClick={() => {
          cancelClose();
          setOpen((o) => !o);
        }}
        className={`h-6 px-1.5 text-[11px] font-medium rounded-md transition-colors flex items-center gap-1.5 cursor-pointer
          ${
            activeMap
              ? 'text-brand-600 hover:bg-brand-50'
              : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
          }`}
        title="Custom maps overlay (m to toggle, shift+m to cycle)"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="opacity-40 shrink-0"
        >
          <path d="M10 2L2 6L10 10L18 6L10 2Z" opacity="0.5" />
          <path d="M2 10L10 14L18 10" />
          <path d="M2 14L10 18L18 14" opacity="0.5" />
        </svg>
        <span className="truncate max-w-[9rem]">{activeMap ? activeMap.map.name : 'Maps'}</span>
        <svg
          width="8"
          height="8"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="opacity-40 shrink-0"
        >
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999]"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <div className="bg-white border border-neutral-200 rounded-lg shadow-lg min-w-[220px]">
              <div className="px-3 py-1.5 text-[11px] font-semibold text-neutral-500 tracking-wide bg-neutral-50 border-b border-neutral-200 rounded-t-lg">
                Custom maps <span className="font-normal opacity-60 ml-1">m / shift+m</span>
              </div>
              <div className="py-1">
                {maps.map((state) => {
                  const isProcessing =
                    state.map.status === 'pending_processing' || state.map.status === 'processing';
                  const isFailed = state.map.status === 'failed';
                  const isReady = state.map.status === 'ready';
                  return (
                    <div key={state.map.id}>
                      {/* Clickable row - using div+onClick instead of radio input so
                        clicking the active item deselects it (native radio can't do this) */}
                      <div
                        role="radio"
                        aria-checked={state.visible}
                        onClick={() => isReady && onSelect(state.map.id)}
                        className={`flex items-center gap-2 px-3 py-2 ${isReady ? 'cursor-pointer hover:bg-neutral-50' : 'cursor-default'} transition-colors`}
                      >
                        <span
                          className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0
                        ${state.visible ? 'border-brand-500 bg-brand-500' : 'border-neutral-300 bg-white'}`}
                        >
                          {state.visible && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </span>
                        <span
                          className={`text-xs flex-1 truncate ${!isReady ? 'text-neutral-400' : 'text-neutral-800'}`}
                        >
                          {state.map.name}
                        </span>
                        {isProcessing && (
                          <span className="text-[10px] text-neutral-400 shrink-0">Processing…</span>
                        )}
                        {isFailed && (
                          <span className="text-[10px] text-red-400 shrink-0">Failed</span>
                        )}
                      </div>
                      {state.visible && isReady && (
                        <div className="pb-2 px-3 pl-8 flex items-center gap-2">
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={state.opacity}
                            onChange={(e) =>
                              onOpacityChange(state.map.id, parseFloat(e.target.value))
                            }
                            className="flex-1 h-1 accent-brand-500"
                            title="Opacity"
                          />
                          <span className="text-[10px] text-neutral-400 w-6 text-right">
                            {Math.round(state.opacity * 100)}%
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default CustomMapsDropdown;
