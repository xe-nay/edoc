import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';

// Asks for Face ID, fingerprint or the device passcode. Resolves true when the person proved who
// they are, and also when the device has no lock at all (there is nothing to ask for).
export async function confirmIdentity(reason: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return true;
  }
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  if (level === LocalAuthentication.SecurityLevel.NONE) {
    return true;
  }
  const result = await LocalAuthentication.authenticateAsync({ promptMessage: reason });
  return result.success;
}

// Name of the app lock in settings.
export const lockName = Platform.OS === 'ios' ? 'Face ID' : 'Biometric Lock';
