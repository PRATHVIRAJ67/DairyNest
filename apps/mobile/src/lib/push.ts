import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api } from './api';
import { config } from './config';

/**
 * Registers this device for Expo push notifications and stores the token on the server.
 * Returns an honest result: remote push needs a physical device, user permission, and an EAS project id
 * (and a development/production build, not Expo Go).
 */
export async function registerForPush(): Promise<{ ok: boolean; message?: string }> {
  if (Platform.OS === 'web') return { ok: false, message: 'Push notifications are not available on the web.' };
  if (!Device.isDevice) return { ok: false, message: 'Push notifications need a physical device.' };
  try {
    const Notifications = await import('expo-notifications');
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return { ok: false, message: 'Permission was denied. You can enable notifications in your phone settings.' };
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'Deliveries and payments', importance: Notifications.AndroidImportance.DEFAULT });
    }
    if (!config.easProjectId) return { ok: false, message: 'Push is not configured for this build (EXPO_PUBLIC_EAS_PROJECT_ID is missing).' };
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: config.easProjectId })).data;
    await api.put('/me/push-token', { token });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not enable push notifications.' };
  }
}

export async function unregisterPush() {
  try { await api.del('/me/push-token'); } catch { /* best effort */ }
}
