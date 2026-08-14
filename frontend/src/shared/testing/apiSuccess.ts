/**
 * The generated client returns `{ data, error, request, response }` (or the
 * throw-on-error `{ data, request, response }` shape) from every SDK call.
 * Tests mock `vi.mocked(sdkFn).mockResolvedValue(...)` and only care about
 * `data`, so this fills in a real `Request`/`Response` for the rest.
 */
export function apiSuccess<T>(data: T): {
  data: T;
  error: undefined;
  request: Request;
  response: Response;
} {
  return {
    data,
    error: undefined,
    request: new Request('http://test.local/'),
    response: new Response(),
  };
}
