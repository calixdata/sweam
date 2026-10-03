import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api } from './api';

/**
 * Push notifications for the app. Android delivery uses FCM: the device token is
 * registered with Sweam, and the server sends via FCM v1 on new followers,
 * replies, and other notifications. Everything is best-effort — the app works
 * fully without push, and without the FCM config it simply never registers.
 */

// Show incoming pushes while the app is in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function deviceToken(): Promise<string | null> {
  try {
    const resp = await Notifications.getDevicePushTokenAsync();
    return typeof resp.data === 'string' ? resp.data : null;
  } catch {
    return null;
  }
}

/** Ask permission (if needed), get the FCM token, and register it with Sweam. */
export async function registerForPush(): Promise<void> {
  try {
    if (!Device.isDevice) return;
    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      const requested = await Notifications.requestPermissionsAsync();
      granted = requested.granted;
    }
    if (!granted) return;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const token = await deviceToken();
    if (token) await api.post('/api/me/push-tokens', { token, platform: Platform.OS });
  } catch {
    // Push is best-effort; never let it break the app.
  }
}

/** Drop this device's token so a signed-out device stops receiving pushes. */
export async function unregisterPush(): Promise<void> {
  try {
    const token = await deviceToken();
    if (token) await api.del('/api/me/push-tokens', { token });
  } catch {
    // ignore
  }
}
