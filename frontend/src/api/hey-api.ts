import { useAccountStore } from '~/features/account/account.store';
import type { Config } from './client/client/types.gen';
import type { ClientOptions } from './client/types.gen';
import { authManager } from '~/features/auth/index';

interface RetryableRequest extends Request {
  _retry?: boolean;
}

let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

const subscribeTokenRefresh = (callback: (token: string) => void) => {
  refreshSubscribers.push(callback);
};

const onTokenRefreshed = (token: string) => {
  refreshSubscribers.forEach((callback) => callback(token));
  refreshSubscribers = [];
};

export const createClientConfig = (
  override?: Config<ClientOptions>
): Config<Required<ClientOptions>> => {
  const config: Config<Required<ClientOptions>> = {
    ...override,
    // Override the generated baseUrl (http://localhost:8000) with the env var.
    // In prod this is empty so requests go to the same origin via nginx proxy.
    baseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  } as Config<Required<ClientOptions>>;

  return config;
};

interface ClientWithInterceptors {
  interceptors: {
    request: {
      use: (handler: (request: Request, options: RequestOptions) => Promise<Request>) => void;
    };
    response: {
      use: (
        handler: (
          response: Response,
          request: Request,
          options: RequestOptions
        ) => Promise<Response>
      ) => void;
    };
  };
}

interface RequestOptions {
  fetch?: typeof fetch;
}

/**
 * Setup authentication and token refresh interceptors for the API client
 */
export const setupClientInterceptors = (client: ClientWithInterceptors): void => {
  // Request interceptor to add auth token
  client.interceptors.request.use(async (request: Request, _options: RequestOptions) => {
    const token = await authManager.getIdToken();

    if (token) {
      const headers = new Headers(request.headers);
      headers.set('Authorization', `Bearer ${token}`);
      return new Request(request, { headers });
    }

    return request;
  });

  // Response interceptor to handle 401 and retry with refreshed token
  client.interceptors.response.use(
    async (response: Response, request: Request, options: RequestOptions) => {
      // Handle 403 email_not_verified - set store flag directly and return
      // response as-is (don't retry, don't logout)
      if (response.status === 403) {
        const cloned = response.clone();
        try {
          const body = await cloned.json();
          if (body?.detail === 'email_not_verified') {
            useAccountStore.getState().clear();
            useAccountStore.setState({ emailNotVerified: true });
          }
        } catch {
          /* not JSON, ignore */
        }
        return response;
      }

      if (response.ok || response.status !== 401) {
        return response;
      }

      const originalRequest = request.clone() as RetryableRequest;

      // Check if we've already tried to refresh for this request
      if (originalRequest._retry) {
        return response;
      }

      // Mark request as retried
      originalRequest._retry = true;

      if (!isRefreshing) {
        isRefreshing = true;

        try {
          // Force refresh the token
          const newToken = await authManager.getIdToken(true);
          onTokenRefreshed(newToken);

          // Retry the original request with new token
          const headers = new Headers(originalRequest.headers);
          headers.set('Authorization', `Bearer ${newToken}`);
          const retryRequest = new Request(originalRequest, { headers });

          const _fetch = options.fetch || globalThis.fetch;
          return await _fetch(retryRequest);
        } catch (err) {
          // Notify all waiting subscribers about the error
          refreshSubscribers.forEach(() => {
            // Subscribers will handle rejection in their own catch block
          });
          refreshSubscribers = [];

          // If refresh fails, logout and redirect to login
          useAccountStore.getState().clear();
          await authManager.logout();
          window.location.href = '/';

          throw err;
        } finally {
          // Always reset the flag in finally block to prevent deadlock
          isRefreshing = false;
        }
      }

      // If already refreshing, wait for the token refresh to complete
      return new Promise<Response>((resolve, reject) => {
        subscribeTokenRefresh(async (token: string) => {
          try {
            const headers = new Headers(originalRequest.headers);
            headers.set('Authorization', `Bearer ${token}`);
            const retryRequest = new Request(originalRequest, { headers });

            const _fetch = options.fetch || globalThis.fetch;
            const retryResponse = await _fetch(retryRequest);
            resolve(retryResponse);
          } catch (error) {
            reject(error);
          }
        });
      });
    }
  );
};
