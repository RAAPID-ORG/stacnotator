import { FirebaseGoogleProvider } from '~/auth/providers/firebaseProvider';
import { FirebaseEmailProvider } from '~/auth/providers/firebaseEmailProvider';
import { authManager } from '~/auth/authManager';

// Create and register providers
const googleAuthProvider = new FirebaseGoogleProvider();
const emailAuthProvider = new FirebaseEmailProvider();

authManager.registerProvider(googleAuthProvider);
authManager.registerProvider(emailAuthProvider);

// Export the manager as the main auth provider
export { authManager };

// Export provider IDs for use in login screens
export const AUTH_PROVIDERS = {
  GOOGLE: 'google',
  EMAIL: 'email',
} as const;
