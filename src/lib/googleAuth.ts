import type { User } from 'firebase/auth';
import {
  GOOGLE_WORKSPACE_SCOPES,
  getCachedDriveAccessToken,
  signInWithGoogleForDrive,
  signOutFirebase,
  subscribeDriveAuthState,
} from './firebaseBridge';

export const SCOPES = GOOGLE_WORKSPACE_SCOPES;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return subscribeDriveAuthState(({ user, hasDriveToken }) => {
    const token = getCachedDriveAccessToken();
    if (user && hasDriveToken && token) {
      if (onAuthSuccess) onAuthSuccess(user, token);
    } else {
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (
  forceAccountPicker = false
): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  return signInWithGoogleForDrive(forceAccountPicker);
};

export const getAccessToken = async (): Promise<string | null> => {
  return getCachedDriveAccessToken();
};

export const logout = async () => {
  await signOutFirebase();
};
