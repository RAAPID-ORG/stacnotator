import { Link, useRouteError, isRouteErrorResponse } from 'react-router-dom';

/** Shared centred content for the 404 / error screens. */
function ErrorContent({ code, title, message }: { code: string; title: string; message: string }) {
  return (
    <div className="mx-auto max-w-xl px-8 py-24 text-center">
      <p className="text-6xl font-semibold tracking-tight text-neutral-300 tabular-nums">{code}</p>
      <h1 className="mt-4 text-xl font-semibold text-neutral-900">{title}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-neutral-600">{message}</p>
      <div className="mt-8 flex items-center justify-center gap-3">
        <Link
          to="/"
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
        >
          Go to home
        </Link>
        <button
          onClick={() => window.location.reload()}
          className="rounded-md border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100"
        >
          Reload
        </button>
      </div>
    </div>
  );
}

/** Catch-all route element: renders inside AppLayout so the sidebar stays. */
export function NotFoundPage() {
  return (
    <div className="flex-1 overflow-auto">
      <ErrorContent
        code="404"
        title="Page not found"
        message="The page you're looking for doesn't exist or may have moved."
      />
    </div>
  );
}

/**
 * Route `errorElement`: replaces the layout when a route (or loader) throws.
 * A thrown 404 still shows the not-found copy; anything else gets a generic
 * recoverable error screen instead of React Router's developer default.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-white">
        <ErrorContent
          code="404"
          title="Page not found"
          message="The page you're looking for doesn't exist or may have moved."
        />
      </div>
    );
  }

  const code = isRouteErrorResponse(error) ? String(error.status) : 'Error';
  const message = isRouteErrorResponse(error)
    ? error.statusText || 'Something went wrong while loading this page.'
    : error instanceof Error
      ? error.message
      : 'An unexpected error occurred. Try reloading the page.';

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-white">
      <ErrorContent code={code} title="Something went wrong" message={message} />
    </div>
  );
}
