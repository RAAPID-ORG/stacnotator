import { useEffect } from 'react';
import { ALERT_AUTO_CLOSE_DURATION } from '~/constants';

export type AlertType = 'success' | 'error' | 'info' | 'warning';

export interface AlertProps {
  message: string | null;
  type?: AlertType;
  onDismiss: () => void;
  autoClose?: boolean;
  autoCloseDuration?: number;
}

interface AlertConfig {
  bgColor: string;
  borderColor: string;
  textColor: string;
  titleColor: string;
  buttonColor: string;
  icon: React.ReactNode;
}

const ALERT_CONFIGS: Record<AlertType, AlertConfig> = {
  success: {
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    textColor: 'text-green-700',
    titleColor: 'text-green-800',
    buttonColor: 'text-green-400 hover:text-green-600',
    icon: (
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
        clipRule="evenodd"
      />
    ),
  },
  error: {
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    textColor: 'text-red-700',
    titleColor: 'text-red-800',
    buttonColor: 'text-red-400 hover:text-red-600',
    icon: (
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
        clipRule="evenodd"
      />
    ),
  },
  info: {
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    textColor: 'text-blue-700',
    titleColor: 'text-blue-800',
    buttonColor: 'text-blue-400 hover:text-blue-600',
    icon: (
      <path
        fillRule="evenodd"
        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
        clipRule="evenodd"
      />
    ),
  },
  warning: {
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
    textColor: 'text-yellow-700',
    titleColor: 'text-yellow-800',
    buttonColor: 'text-yellow-400 hover:text-yellow-600',
    icon: (
      <path
        fillRule="evenodd"
        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
        clipRule="evenodd"
      />
    ),
  },
};

/**
 * Alert notification component
 * Displays dismissible notifications with auto-close functionality
 */
export const Alert = ({
  message,
  type = 'info',
  onDismiss,
  autoClose = true,
  autoCloseDuration,
}: AlertProps) => {
  const duration = autoCloseDuration ?? ALERT_AUTO_CLOSE_DURATION[type.toUpperCase() as keyof typeof ALERT_AUTO_CLOSE_DURATION];

  useEffect(() => {
    if (message && autoClose) {
      const timer = setTimeout(onDismiss, duration);
      return () => clearTimeout(timer);
    }
  }, [message, autoClose, duration, onDismiss]);

  if (!message) return null;

  const config = ALERT_CONFIGS[type];

  return (
    <div className="fixed top-4 right-4 max-w-sm animate-slide-in-right z-50">
      <div className={`${config.bgColor} border ${config.borderColor} rounded-lg p-4 shadow-lg`}>
        <div className="flex items-start gap-3">
          <svg
            className={`w-5 h-5 ${config.textColor} flex-shrink-0 mt-0.5`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            {config.icon}
          </svg>
          <div className="flex-1">
            <h3 className={`font-medium ${config.titleColor} capitalize`}>{type}</h3>
            <p className={`text-sm ${config.textColor} mt-1`}>{message}</p>
          </div>
          <button
            onClick={onDismiss}
            className={`${config.buttonColor} transition-colors flex-shrink-0`}
            aria-label={`Dismiss ${type}`}
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};
