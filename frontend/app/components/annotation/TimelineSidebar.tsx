import type { ImageryWithWindowsOut } from '~/api/client';
import type { TimeSlice } from '~/utils/utility';
import { formatYearMonth, formatWindowLabel } from '~/utils/utility';

interface TimelineSidebarProps {
  imagery: ImageryWithWindowsOut | null;
  activeWindowId: number | null;
  slices: TimeSlice[];
  activeSliceIndex: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onWindowChange?: (windowId: number) => void;
  onSliceChange?: (sliceIndex: number) => void;
}

const TimelineSidebar = ({
  imagery,
  activeWindowId,
  slices,
  activeSliceIndex,
  collapsed,
  onToggleCollapse,
  onWindowChange,
  onSliceChange,
}: TimelineSidebarProps) => {
  if (!imagery) {
    return null;
  }

  const windows = imagery.windows;
  const startDate = imagery.start_ym;
  const endDate = imagery.end_ym;

  // Calculate the height for each window segment
  const totalWindows = windows.length;

  return (
    <div className="relative h-full">
      {/* Collapse/Expand Button - Right Border of Sidebar */}
      <button
        onClick={onToggleCollapse}
        className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-full z-[1001] w-4 h-10 bg-neutral-200 hover:bg-neutral-300 text-neutral-500 hover:text-neutral-700 rounded-r border border-l-0 border-neutral-300 transition-colors cursor-pointer flex items-center justify-center"
        title={collapsed ? 'Show timeline' : 'Hide timeline'}
      >
        <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" className={`transition-transform ${collapsed ? '' : 'rotate-180'}`}>
          <path d="M7 1L1 7L7 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        </svg>
      </button>

      <div
        className={`transition-all duration-300 ease-in-out overflow-hidden border-r border-gray-300 h-full bg-white ${
          collapsed ? 'w-0' : 'w-[40px]'
        }`}
      >
        {!collapsed && (
          <div className="h-full flex flex-col px-1 py-1">
            {/* Start Date Label */}
            <div className="text-[10px] font-medium text-neutral-700 mb-1 text-center">
              {formatYearMonth(startDate)}
            </div>

            {/* Timeline Track */}
            <div className="flex-1 flex flex-col relative items-center">
              {/* Vertical Line */}
              <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-0.5 bg-brand-500"></div>

              {/* Wider tart separator */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-px bg-brand-500"></div>

              {/* Windows */}
              {windows.map((window, index) => {
                const isActive = window.id === activeWindowId;
                const segmentHeight = `${100 / totalWindows}%`;
                const isLastWindow = index === windows.length - 1;
                const previousWindowIsActive = index > 0 && windows[index - 1].id === activeWindowId;
                const hasMultipleSlices = isActive && slices.length > 1;
                const windowLabel = formatWindowLabel(window.window_start_date, window.window_end_date, imagery.window_unit);

                return (
                  <div
                    key={window.id}
                    className="relative flex items-center justify-center group/window"
                    style={{ 
                      height: isActive ? 'auto' : segmentHeight, 
                      minHeight: segmentHeight,
                      width: '100%' 
                    }}
                  >
                    {isActive ? (
                      // Active window - highlighted segment with slices
                      <div 
                        className="flex flex-col items-center justify-center border-brand-500 border-2 rounded-sm bg-white z-10 transition-all duration-200 ease-out py-1" 
                        style={{ 
                          minHeight: '100%',
                          maxWidth: '35px',
                          width: '100%',
                        }}
                      >
                        {/* Window label */}
                        <span className="text-[8px] font-bold text-neutral-700 leading-tight text-center w-full">
                          {windowLabel}
                        </span>
                        {hasMultipleSlices ? (
                          // Show slices horizontally within the active window
                          <div className="flex flex-row w-full items-center justify-center gap-0.5 px-0.5">
                            {slices.map((slice, sliceIdx) => {
                              const isActiveSlice = sliceIdx === activeSliceIndex;
                              
                              return (
                                <button
                                  key={sliceIdx}
                                  onClick={() => onSliceChange?.(sliceIdx)}
                                  className={`w-1.5 h-1.5 rounded-full cursor-pointer transition-colors duration-150 ${
                                    isActiveSlice 
                                      ? 'bg-brand-500' 
                                      : 'bg-neutral-300 hover:bg-neutral-400'
                                  }`}
                                  title={slice.label}
                                />
                              );
                            })}
                          </div>
                        ) : (
                          // Single slice or no slicing - just show a simple indicator
                          <div className="text-[9px] font-small text-neutral-700 text-center px-1 leading-tight">
                            •
                          </div>
                        )}
                      </div>
                    ) : (
                      // Inactive window - clickable area with horizontal separator at top (if previous isn't active)
                      <button
                        onClick={() => onWindowChange?.(window.id)}
                        className="absolute inset-0 group cursor-pointer border-2 border-transparent hover:border-brand-500 hover:bg-white rounded-sm transition-all duration-200 ease-out z-10 hover:z-20"
                      >
                        {!previousWindowIsActive && (
                          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-px bg-brand-500 group-hover:opacity-0 transition-opacity duration-200 ease-out"></div>
                        )}
                        {/* Hover label inside the window */}
                        <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-neutral-700 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                          {windowLabel}
                        </span>
                      </button>
                    )}
                    {/* Show wider separator at bottom of last window if it's not active */}
                    {!isActive && isLastWindow && (
                      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-px bg-brand-500 pointer-events-none group-hover:opacity-0 transition-opacity duration-200 ease-out"></div>
                    )}
                  </div>
                );
              })}

            </div>

            {/* End Date Label */}
            <div className="text-[10px] font-medium text-neutral-700 mt-1 text-center">
              {formatYearMonth(endDate)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TimelineSidebar;
