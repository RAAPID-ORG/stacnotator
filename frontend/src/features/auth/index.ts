import { authManager } from './core/authManager';
import { FirebaseGoogleAdapter } from './adapters/firebase/google.adapter';
import { FirebaseEmailAdapter } from './adapters/firebase/email.adapter';

// Register adapters once at module load.
authManager.registerProvider(new FirebaseGoogleAdapter());
authManager.registerProvider(new FirebaseEmailAdapter());

export { authManager };

export const AUTH_PROVIDERS = {
  GOOGLE: 'google',
  EMAIL: 'email',
} as const;
