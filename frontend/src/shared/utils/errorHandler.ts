import { useLayoutStore } from "~/features/layout/layout.store";

export interface ErrorHandlerOptions {
  /**
   * Whether to show the error message to the user via alert
   * @default true
   */
  showUser?: boolean;

  /**
   * Custom user-friendly message to display instead of the error message
   */
  userMessage?: string;

  /**
   * Whether to log the error to console for debugging
   * @default true
   */
  logToConsole?: boolean;

  /**
   * Alert type to use when showing to user
   * @default 'error'
   */
  alertType?: 'error' | 'warning' | 'info';

  /**
   * Whether to send to external error tracking service (future enhancement)
   * @default false
   */
  logToService?: boolean;
}

/**
 * Centralized error handling utility
 *
 * Provides consistent error handling across the application:
 * - Logs errors to console for debugging
 * - Shows user-friendly messages via UI alerts
 * - Future: Send to error tracking service
 *
 * @param error - The error object or message
 * @param context - Description of where/why the error occurred
 * @param options - Configuration for how to handle the error
 * @returns The error message that was processed
 *
 * @example
 * ```ts
 * try {
 *   await someApiCall();
 * } catch (error) {
 *   handleError(error, 'Failed to load campaign', {
 *     showUser: true,
 *     userMessage: 'Unable to load campaign. Please try again.'
 *   });
 * }
 * ```
 */
export const handleError = (
  error: unknown,
  context: string,
  options: ErrorHandlerOptions = {}
): string => {
  const {
    showUser = true,
    userMessage,
    logToConsole = true,
    alertType = 'error',
    logToService = false,
  } = options;

  // Extract error message
  const errorMessage = error instanceof Error ? error.message : String(error);
  const displayMessage = userMessage || errorMessage;

  // Log to console for debugging (in all environments)
  if (logToConsole) {
    console.error(`[${context}]`, {
      message: errorMessage,
      error,
      timestamp: new Date().toISOString(),
    });
  }

  // Show to user via alert
  if (showUser) {
    useLayoutStore.getState().showAlert(displayMessage, alertType);
  }

  // Future: Send to error tracking service (e.g., Sentry)
  if (logToService && import.meta.env.PROD) {
    // TODO: Implement error tracking service integration
    // e.g., Sentry.captureException(error, { tags: { context } });
  }

  return displayMessage;
};

/**
 * Helper for handling API errors specifically
 * Extracts status codes and provides better error messages
 */
export const handleApiError = (
  error: unknown,
  context: string,
  options: Omit<ErrorHandlerOptions, 'userMessage'> & {
    defaultMessage?: string;
  } = {}
): string => {
  const { defaultMessage = 'An error occurred', ...restOptions } = options;

  let userMessage = defaultMessage;

  // Handle axios errors or fetch errors with status codes
  if (error && typeof error === 'object' && 'response' in error) {
    const axiosError = error as { response?: { status?: number; data?: { detail?: string } } };
    const status = axiosError.response?.status;
    const detail = axiosError.response?.data?.detail;

    switch (status) {
      case 401:
        userMessage = 'Authentication required. Please log in again.';
        break;
      case 403:
        userMessage = 'You do not have permission to perform this action.';
        break;
      case 404:
        userMessage = 'The requested resource was not found.';
        break;
      case 500:
        userMessage = 'Server error. Please try again later.';
        break;
      default:
        userMessage = detail || defaultMessage;
    }
  }

  return handleError(error, context, { ...restOptions, userMessage });
};
