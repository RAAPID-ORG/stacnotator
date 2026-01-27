import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Layout } from 'react-grid-layout';
import type { TaskFilterType } from '~/stores/annotationStore';

// Task filter options
const taskFilterOptions: { value: TaskFilterType; label: string }[] = [
  { value: 'assigned-pending', label: 'Mine Pending' },
  { value: 'assigned-all', label: 'Mine All' },
  { value: 'assigned-completed', label: 'Mine Completed' },
  { value: 'pending', label: 'Overall Pending' },
  { value: 'all', label: 'Overall All' },
  { value: 'completed', label: 'Overall Completed' },

];

import { useAnnotationStore } from '~/stores/annotationStore';
import { useUIStore } from '~/stores/uiStore';

const KEYBOARD_SHORTCUTS = [
  { key: 'W / S', description: 'Previous / Next task' },
  { key: 'A / D', description: 'Previous / Next slice' },
  { key: 'Shift+A / D', description: 'Previous / Next window' },
  { key: '↑ ↓ ← →', description: 'Pan map' },
  { key: 'Alt+↑ / ↓', description: 'Zoom in / out' },
  { key: 'Space', description: 'Recenter maps' },
  { key: '1-9, 0', description: 'Select label by number' },
  { key: 'Enter', description: 'Submit annotation' },
  { key: 'B', description: 'Skip annotation' },
  { key: 'C', description: 'Focus comment' },
  { key: 'Escape', description: 'Unfocus input' },
  { key: 'H', description: 'Toggle keyboard help' },
];

/**
 * Toolbar for annotation page with imagery selection and layout controls
 */
export const AnnotationToolbar = () => {
  const navigate = useNavigate();
  const [showImageryDropdown, setShowImageryDropdown] = useState(false);
  const [showTaskFilterDropdown, setShowTaskFilterDropdown] = useState(false);
  const [showSaveDropdown, setShowSaveDropdown] = useState(false);
  
  const imageryDropdownRef = useRef<HTMLDivElement>(null);
  const taskFilterDropdownRef = useRef<HTMLDivElement>(null);
  const saveDropdownRef = useRef<HTMLDivElement>(null);

  // Get state from store
  const campaign = useAnnotationStore(state => state.campaign);
  const isEditingLayout = useAnnotationStore(state => state.isEditingLayout);
  const selectedImageryId = useAnnotationStore(state => state.selectedImageryId);
  const taskFilter = useAnnotationStore(state => state.taskFilter);
  const setIsEditingLayout = useAnnotationStore(state => state.setIsEditingLayout);
  const saveLayout = useAnnotationStore(state => state.saveLayout);
  const cancelLayoutEdit = useAnnotationStore(state => state.cancelLayoutEdit);
  const resetLayout = useAnnotationStore(state => state.resetLayout);
  const setSelectedImageryId = useAnnotationStore(state => state.setSelectedImageryId);
  const setTaskFilter = useAnnotationStore(state => state.setTaskFilter);
  
  // Get UI actions from global store
  const showAlert = useUIStore(state => state.showAlert);
  const showKeyboardHelp = useUIStore(state => state.showKeyboardHelp);
  const toggleKeyboardHelp = useUIStore(state => state.toggleKeyboardHelp);
  const setShowKeyboardHelp = useUIStore(state => state.setShowKeyboardHelp);
  const isFullscreen = useUIStore(state => state.isFullscreen);
  const toggleFullscreen = useUIStore(state => state.toggleFullscreen);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (imageryDropdownRef.current && !imageryDropdownRef.current.contains(event.target as Node)) {
        setShowImageryDropdown(false);
      }
      if (taskFilterDropdownRef.current && !taskFilterDropdownRef.current.contains(event.target as Node)) {
        setShowTaskFilterDropdown(false);
      }
      if (saveDropdownRef.current && !saveDropdownRef.current.contains(event.target as Node)) {
        setShowSaveDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!campaign) return null;

  const imagerySources = campaign.imagery;
  const selectedImagery = imagerySources.find((img) => img.id === selectedImageryId);

  // Check if main layout items have changed
  const hasMainLayoutChanged = () => {
    const { currentLayout, savedLayout } = useAnnotationStore.getState();
    if (!currentLayout || !savedLayout) return false;
    
    const mainItemKeys = ['main', 'timeseries', 'minimap'];
    const currentMainItems = currentLayout.filter(item => mainItemKeys.includes(item.i));
    const savedMainItems = savedLayout.filter(item => mainItemKeys.includes(item.i));
    
    // Compare main layout items
    return JSON.stringify(currentMainItems) !== JSON.stringify(savedMainItems);
  };

  const handleSaveLayout = async (shouldBeDefault: boolean) => {
    // Check if saving as default
    if (shouldBeDefault) {
      const confirmMessage = 'Are you sure you want to save this as the default layout?\n\nThis will overwrite the default layout for ALL users in this campaign.';
      if (!window.confirm(confirmMessage)) {
        setShowSaveDropdown(false);
        return;
      }
    }
    
    // Check if main layout changed and there are multiple imagery sources
    if (hasMainLayoutChanged() && imagerySources.length > 1) {
      const layoutType = shouldBeDefault ? 'default' : 'personal';
      const confirmMessage = `Warning: You have modified the main layout (main map, timeseries, or minimap).\n\nThis change will be applied to ALL imagery sources and may cause layouts to shift.\n\nDo you want to save this ${layoutType} layout?`;
      if (!window.confirm(confirmMessage)) {
        setShowSaveDropdown(false);
        return;
      }
    }
    
    await saveLayout(shouldBeDefault);
    setShowSaveDropdown(false);
  };

  const handleResetLayout = () => {
    if (!window.confirm('Reset canvas layout to campaign defaults?')) return;
    
    // Merge main and imagery layouts
    const mainLayout = campaign.default_main_canvas_layout!.layout_data as Layout;
    const imageryLayout = selectedImagery?.default_canvas_layout?.layout_data as Layout | undefined;
    const mergedLayout = imageryLayout ? [...mainLayout, ...imageryLayout] : mainLayout;
    
    resetLayout(mergedLayout);
    showAlert('Layout reset to defaults', 'success');
  };

  return (
    <header className="flex items-center justify-between px-4 py-0 bg-white border-b border-gray-200 flex-shrink-0">
      <div className="flex items-center gap-2">
        {/* Imagery Dropdown */}
        <div className="relative" ref={imageryDropdownRef}>
          <button
            onClick={() => setShowImageryDropdown(!showImageryDropdown)}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-900 hover:bg-neutral-100 rounded transition-colors ${showImageryDropdown ? 'bg-neutral-100' : ''}`}
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M3.5 3C2.67157 3 2 3.67157 2 4.5V15.5C2 16.3284 2.67157 17 3.5 17H16.5C17.3284 17 18 16.3284 18 15.5V4.5C18 3.67157 17.3284 3 16.5 3H3.5ZM3 4.5C3 4.22386 3.22386 4 3.5 4H16.5C16.7761 4 17 4.22386 17 4.5V11.7929L14.8536 9.64645C14.6583 9.45118 14.3417 9.45118 14.1464 9.64645L11 12.7929L8.85355 10.6464C8.65829 10.4512 8.34171 10.4512 8.14645 10.6464L3 15.7929V4.5ZM3.20711 16L8 11.2071L10.1464 13.3536C10.3417 13.5488 10.6583 13.5488 10.8536 13.3536L14 10.2071L17 13.2071V15.5C17 15.7761 16.7761 16 16.5 16H3.5C3.39645 16 3.29871 15.9682 3.20711 16ZM13 7.5C13 8.32843 12.3284 9 11.5 9C10.6716 9 10 8.32843 10 7.5C10 6.67157 10.6716 6 11.5 6C12.3284 6 13 6.67157 13 7.5Z" />
            </svg>
            <span>{selectedImagery ? selectedImagery.name : 'Select Imagery'}</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.29289 6.29289C4.68342 5.90237 5.31658 5.90237 5.70711 6.29289L8 8.58579L10.2929 6.29289C10.6834 5.90237 11.3166 5.90237 11.7071 6.29289C12.0976 6.68342 12.0976 7.31658 11.7071 7.70711L8.70711 10.7071C8.31658 11.0976 7.68342 11.0976 7.29289 10.7071L4.29289 7.70711C3.90237 7.31658 3.90237 6.68342 4.29289 6.29289Z" />
            </svg>
          </button>
          {showImageryDropdown && (
            <div className="absolute top-full left-0 bg-white border border-neutral-300 rounded-b shadow-lg z-10 min-w-[200px] max-h-[400px] overflow-y-auto">
              {imagerySources.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-500">No imagery sources available</div>
              ) : (
                imagerySources.map((imagery) => (
                  <button
                    key={imagery.id}
                    onClick={() => {
                      setSelectedImageryId(imagery.id);
                      setShowImageryDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-neutral-100 transition-colors ${
                      selectedImageryId === imagery.id
                        ? 'bg-neutral-100 text-brand-700 font-medium'
                        : 'text-neutral-900'
                    }`}
                    type="button"
                  >
                    <div className="font-medium">{imagery.name}</div>
                    <div className="text-xs text-gray-500">
                      {imagery.start_ym} - {imagery.end_ym}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Task Filter Dropdown (custom) */}
        {campaign.mode === "tasks" && <div className="relative" ref={taskFilterDropdownRef}>
          <button
            onClick={() => setShowTaskFilterDropdown(!showTaskFilterDropdown)}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-900 hover:bg-neutral-100 rounded transition-colors ${showTaskFilterDropdown ? 'bg-neutral-100' : ''}`}
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3h9A1.5 1.5 0 0 1 16 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 15.5v-11ZM5.5 4a.5.5 0 0 0-.5.5V6h10V4.5a.5.5 0 0 0-.5-.5h-9ZM15 7H5v8.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V7Zm-8 2h6v1H7V9Zm0 2h6v1H7v-1Z" />
            </svg>
            <span>{taskFilterOptions.find(opt => opt.value === taskFilter)?.label || 'Task Filter'}</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.29289 6.29289C4.68342 5.90237 5.31658 5.90237 5.70711 6.29289L8 8.58579L10.2929 6.29289C10.6834 5.90237 11.3166 5.90237 11.7071 6.29289C12.0976 6.68342 12.0976 7.31658 11.7071 7.70711L8.70711 10.7071C8.31658 11.0976 7.68342 11.0976 7.29289 10.7071L4.29289 7.70711C3.90237 7.31658 3.90237 6.68342 4.29289 6.29289Z" />
            </svg>
          </button>
          {showTaskFilterDropdown && (
            <div className="absolute top-full left-0 bg-white border border-neutral-300 rounded-b shadow-lg z-10 min-w-[200px] max-h-[400px] overflow-y-auto">
              {taskFilterOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setTaskFilter(opt.value);
                    setShowTaskFilterDropdown(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-neutral-100 transition-colors ${
                    taskFilter === opt.value
                      ? 'bg-neutral-100 text-brand-700 font-medium'
                      : 'text-neutral-900'
                  }`}
                  type="button"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div> 
        }

        {/* View Annotations Button */}
        <button
          onClick={() => navigate(`/campaigns/${campaign.id}/annotations`)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-700 bg-white hover:bg-neutral-50 rounded transition-colors"
          type="button"
          title="View all annotations"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 3C5.58173 3 2 6.58173 2 11C2 15.4183 5.58173 19 10 19C14.4183 19 18 15.4183 18 11C18 9.68678 17.6997 8.44559 17.1652 7.34338L16.2812 8.22736C16.7457 9.08509 17 10.0139 17 11C17 14.866 13.866 18 10 18C6.13401 18 3 14.866 3 11C3 7.13401 6.13401 4 10 4C11.3132 4 12.5544 4.30033 13.6566 4.83482L14.5406 3.95084C13.4384 3.34976 12.1971 3 10 3ZM17.8536 2.14645L8.5 11.5L5.85355 8.85355L5.14645 9.56066L8.14645 12.5607C8.34171 12.7559 8.65829 12.7559 8.85355 12.5607L18.5607 2.85355L17.8536 2.14645Z" />
          </svg>
          <span>Annotations</span>
        </button>
      </div>

  {/* Right - Layout Controls */}
      <div className="flex items-center gap-2">
        {!isEditingLayout ? (
          <button
            onClick={() => setIsEditingLayout(true)}
            className="flex items-center px-3 py-1.5 text-sm text-brand-800 hover:bg-neutral-100 rounded transition-all"
          >
            ✎ Edit Layout
          </button>
        ) : (
          <div className="flex items-center gap-1 bg-neutral-50 rounded px-1">
            {/* Save Dropdown */}
            <div className="relative" ref={saveDropdownRef}>
              <button
                onClick={() => setShowSaveDropdown(!showSaveDropdown)}
                className="px-3 py-1 text-xs font-medium text-brand-800 hover:text-brand-600 flex items-center gap-1"
                type="button"
              >
                Save
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4.29289 6.29289C4.68342 5.90237 5.31658 5.90237 5.70711 6.29289L8 8.58579L10.2929 6.29289C10.6834 5.90237 11.3166 5.90237 11.7071 6.29289C12.0976 6.68342 12.0976 7.31658 11.7071 7.70711L8.70711 10.7071C8.31658 11.0976 7.68342 11.0976 7.29289 10.7071L4.29289 7.70711C3.90237 7.31658 3.90237 6.68342 4.29289 6.29289Z" />
                </svg>
              </button>
              {showSaveDropdown && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-neutral-300 rounded shadow-lg z-20 min-w-[160px]">
                  <button
                    onClick={() => handleSaveLayout(false)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-neutral-100 transition-colors text-neutral-900"
                    type="button"
                  >
                    <div className="font-medium">Save as Personal</div>
                    <div className="text-[10px] text-gray-500">Only for you</div>
                  </button>
                  <button
                    onClick={() => handleSaveLayout(true)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-neutral-100 transition-colors text-neutral-900 border-t border-neutral-200"
                    type="button"
                  >
                    <div className="font-medium">Save as Default</div>
                    <div className="text-[10px] text-gray-500">For all users</div>
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={handleResetLayout}
              className="px-3 py-1 text-xs font-medium text-brand-800 hover:text-amber-600"
            >
              Reset
            </button>
            <button
              onClick={cancelLayoutEdit}
              className="px-3 py-1 text-xs font-medium text-brand-800 hover:text-red-600"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Fullscreen Toggle */}
        <button
          onClick={toggleFullscreen}
          className="flex items-center justify-center w-8 h-8 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded transition-colors"
          title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          type="button"
        >
          {isFullscreen ? (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M3.5 2C3.22386 2 3 2.22386 3 2.5V7.5C3 7.77614 3.22386 8 3.5 8C3.77614 8 4 7.77614 4 7.5V3.70711L7.14645 6.85355C7.34171 7.04882 7.65829 7.04882 7.85355 6.85355C8.04882 6.65829 8.04882 6.34171 7.85355 6.14645L4.70711 3H8.5C8.77614 3 9 2.77614 9 2.5C9 2.22386 8.77614 2 8.5 2H3.5ZM11 2.5C11 2.22386 11.2239 2 11.5 2H16.5C16.7761 2 17 2.22386 17 2.5V7.5C17 7.77614 16.7761 8 16.5 8C16.2239 8 16 7.77614 16 7.5V3.70711L12.8536 6.85355C12.6583 7.04882 12.3417 7.04882 12.1464 6.85355C11.9512 6.65829 11.9512 6.34171 12.1464 6.14645L15.2929 3H11.5C11.2239 3 11 2.77614 11 2.5ZM3.5 12C3.77614 12 4 12.2239 4 12.5V16.2929L7.14645 13.1464C7.34171 12.9512 7.65829 12.9512 7.85355 13.1464C8.04882 13.3417 8.04882 13.6583 7.85355 13.8536L4.70711 17H8.5C8.77614 17 9 17.2239 9 17.5C9 17.7761 8.77614 18 8.5 18H3.5C3.22386 18 3 17.7761 3 17.5V12.5C3 12.2239 3.22386 12 3.5 12ZM16.5 12C16.7761 12 17 12.2239 17 12.5V17.5C17 17.7761 16.7761 18 16.5 18H11.5C11.2239 18 11 17.7761 11 17.5C11 17.2239 11.2239 17 11.5 17H15.2929L12.1464 13.8536C11.9512 13.6583 11.9512 13.3417 12.1464 13.1464C12.3417 12.9512 12.6583 12.9512 12.8536 13.1464L16 16.2929V12.5C16 12.2239 16.2239 12 16.5 12Z" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M2.5 3C2.22386 3 2 3.22386 2 3.5V8.5C2 8.77614 2.22386 9 2.5 9C2.77614 9 3 8.77614 3 8.5V4.70711L6.64645 8.35355C6.84171 8.54882 7.15829 8.54882 7.35355 8.35355C7.54882 8.15829 7.54882 7.84171 7.35355 7.64645L3.70711 4H7.5C7.77614 4 8 3.77614 8 3.5C8 3.22386 7.77614 3 7.5 3H2.5ZM12 3.5C12 3.22386 12.2239 3 12.5 3H17.5C17.7761 3 18 3.22386 18 3.5V8.5C18 8.77614 17.7761 9 17.5 9C17.2239 9 17 8.77614 17 8.5V4.70711L13.3536 8.35355C13.1583 8.54882 12.8417 8.54882 12.6464 8.35355C12.4512 8.15829 12.4512 7.84171 12.6464 7.64645L16.2929 4H12.5C12.2239 4 12 3.77614 12 3.5ZM2.5 11C2.77614 11 3 11.2239 3 11.5V15.2929L6.64645 11.6464C6.84171 11.4512 7.15829 11.4512 7.35355 11.6464C7.54882 11.8417 7.54882 12.1583 7.35355 12.3536L3.70711 16H7.5C7.77614 16 8 16.2239 8 16.5C8 16.7761 7.77614 17 7.5 17H2.5C2.22386 17 2 16.7761 2 16.5V11.5C2 11.2239 2.22386 11 2.5 11ZM17.5 11C17.7761 11 18 11.2239 18 11.5V16.5C18 16.7761 17.7761 17 17.5 17H12.5C12.2239 17 12 16.7761 12 16.5C12 16.2239 12.2239 16 12.5 16H16.2929L12.6464 12.3536C12.4512 12.1583 12.4512 11.8417 12.6464 11.6464C12.8417 11.4512 13.1583 11.4512 13.3536 11.6464L17 15.2929V11.5C17 11.2239 17.2239 11 17.5 11Z" />
            </svg>
          )}
        </button>

        {/* Keyboard Shortcuts Help */}
        <div className="relative">
          <button
            onClick={toggleKeyboardHelp}
            onBlur={() => setTimeout(() => setShowKeyboardHelp(false), 150)}
            className="flex items-center justify-center w-8 h-8 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded transition-colors"
            title="Keyboard shortcuts"
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" clipRule="evenodd" d="M10 2C5.58172 2 2 5.58172 2 10C2 14.4183 5.58172 18 10 18C14.4183 18 18 14.4183 18 10C18 5.58172 14.4183 2 10 2ZM10 3.5C6.41015 3.5 3.5 6.41015 3.5 10C3.5 13.5899 6.41015 16.5 10 16.5C13.5899 16.5 16.5 13.5899 16.5 10C16.5 6.41015 13.5899 3.5 10 3.5ZM10 6C10.4142 6 10.75 6.33579 10.75 6.75V7.25C10.75 7.66421 10.4142 8 10 8C9.58579 8 9.25 7.66421 9.25 7.25V6.75C9.25 6.33579 9.58579 6 10 6ZM10 9C10.4142 9 10.75 9.33579 10.75 9.75V13.25C10.75 13.6642 10.4142 14 10 14C9.58579 14 9.25 13.6642 9.25 13.25V9.75C9.25 9.33579 9.58579 9 10 9Z" />
            </svg>
          </button>

          {showKeyboardHelp && (
            <div className="absolute top-full right-0 mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg z-20 min-w-[220px] p-3">
              <div className="text-xs font-semibold text-neutral-700 mb-2 uppercase tracking-wide">
                Keyboard Shortcuts
              </div>
              <div className="space-y-1.5">
                {KEYBOARD_SHORTCUTS.map((shortcut) => (
                  <div key={shortcut.key} className="flex justify-between items-center text-xs">
                    <span className="text-neutral-600">{shortcut.description}</span>
                    <kbd className="ml-2 px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono text-neutral-700">
                      {shortcut.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
