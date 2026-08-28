import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconClose } from './Icons';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
  footer?: ReactNode;
}

/**
 * A dialog that never grows past the viewport. The body scrolls rather than the
 * page, and the header and footer stay put - so a long list is reachable on a
 * short screen instead of being clipped by the shell's `overflow-hidden`.
 */
export const Modal = ({ title, onClose, children, maxWidth = 'max-w-sm', footer }: ModalProps) =>
  createPortal(
    <div className="fixed inset-0 z-[60] bg-neutral-900/40 flex items-center justify-center p-4">
      <div
        className={`w-full ${maxWidth} bg-white rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[85vh]`}
      >
        <div className="px-5 py-3 border-b border-neutral-200 flex justify-between items-center shrink-0">
          <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-700 cursor-pointer transition-colors"
          >
            <IconClose />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-neutral-200 shrink-0">{footer}</div>}
      </div>
    </div>,
    document.body
  );
