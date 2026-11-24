import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { supabase } from './supabase'

/** Registers this phone for push and stores its Expo token. Native devices only; no-op elsewhere. */
export async function registerForPush(userId: string): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) return null
  const projectId = Constants.expoConfig?.extra?.eas?.projectId
  if (!projectId) return null // set after `eas init`
  if (Platform.OS === 'android') {
    // eslint-disable-next-line import/namespace -- AndroidImportance is re-exported via `export *`; the rule can't follow it (tsc verifies it)
    await Notifications.setNotificationChannelAsync('default', { name: 'Uncle Kit', importance: Notifications.AndroidImportance.DEFAULT })
  }
  const { status: existing } = await Notifications.getPermissionsAsync()
  const status = existing === 'granted' ? existing : (await Notifications.requestPermissionsAsync()).status
  if (status !== 'granted') return null
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data
  await supabase.from('push_tokens').upsert({ user_id: userId, token, platform: Platform.OS as 'android' | 'ios' })
  return token
}
