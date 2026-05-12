import { useLayoutStore } from '~/features/layout/layout.store';

export type AlertType = 'success' | 'error' | 'warning' | 'info';

export interface HandleErrorOptions {
  /** Show a user-facing toast. Defaults to true. */
  showUser?: boolean;
  /** Toast type. Defaults to 'error'. */
  alertType?: AlertType;
  /** Override the user-facing message. By default we extract from the error and fall back to `context`. */
  userMessage?: string;
}

const extractRequestId = (err: unknown): string | null => {
  if (err && typeof err === 'object' && 'request_id' in err) {
    const id = (err as { request_id: unknown }).request_id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return null;
};

const extractBaseMessage = (err: unknown, fallback: string): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'detail' in err) {
    const detail = (err as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      const messages = detail
        .map((d) =>
          d &&
          typeof d === 'object' &&
          'msg' in d &&
          typeof (d as { msg: unknown }).msg === 'string'
            ? (d as { msg: string }).msg
            : null
        )
        .filter((m): m is string => m !== null);
      if (messages.length > 0) return messages.join('; ');
    }
  }
  return fallback;
};

/**
 * Pulls a human-readable message out of an unknown error. Handles native
 * Errors, strings, FastAPI HTTPException bodies (`{detail: string}`), and
 * FastAPI/pydantic validation bodies (`{detail: [{msg, loc, type, ...}]}`).
 * If the backend includes a `request_id`, appends an 8-char prefix as a
 * support reference. Falls back to `fallback` for anything else.
 */
export const extractErrorMessage = (err: unknown, fallback = 'Something went wrong'): string => {
  const base = extractBaseMessage(err, fallback);
  const requestId = extractRequestId(err);
  return requestId ? `${base} (ref: ${requestId.slice(0, 8)})` : base;
};

/**
 * Centralized error handling: logs a structured record and surfaces a toast.
 * `context` is both the log label and the default user-facing message if the
 * error itself carries no message.
 */
export const handleError = (
  err: unknown,
  context: string,
  options: HandleErrorOptions = {}
): string => {
  const { showUser = true, alertType = 'error', userMessage } = options;
  const displayMessage = userMessage ?? extractErrorMessage(err, context);

  console.error(`[${context}]`, {
    message: displayMessage,
    error: err,
    timestamp: new Date().toISOString(),
  });

  if (showUser) {
    useLayoutStore.getState().showAlert(displayMessage, alertType);
  }

  return displayMessage;
};
