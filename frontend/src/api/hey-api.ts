import { apiBase } from './base';
import type { Config } from './client/client/types.gen';
import type { ClientOptions } from './client/types.gen';

export const createClientConfig = (
  override?: Config<ClientOptions>
): Config<Required<ClientOptions>> => {
  const config: Config<Required<ClientOptions>> = {
    ...override,
    // Override the generated baseUrl (http://localhost:8000) with the env var.
    baseUrl: apiBase(),
    credentials: 'include',
  } as Config<Required<ClientOptions>>;

  return config;
};
