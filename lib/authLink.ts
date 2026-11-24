import { Linking, Platform } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { supabase } from './supabase'

/** Where sign-in sends people back to: the app itself (or the page, on web). */
export function authRedirectUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin + '/'
  return 'unclekit://auth'
}

/** Reads tokens from a sign-in link (fragment or query) and starts the session. Returns true if it did. */
export async function handleAuthUrl(url: string | null | undefined): Promise<boolean> {
  if (!url) return false
  const raw = (url.split('#')[1] ?? url.split('?')[1] ?? '')
  const params = new URLSearchParams(raw)
  const access_token = params.get('access_token')
  const refresh_token = params.get('refresh_token')
  if (!access_token || !refresh_token) return false
  const { error } = await supabase.auth.setSession({ access_token, refresh_token })
  return !error
}

/** Handles the link that opened the app, and any link that arrives while it's open. */
export function listenForAuthLinks(): () => void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      handleAuthUrl(window.location.href).then((ok) => { if (ok) window.history.replaceState(null, '', window.location.pathname) })
    }
    return () => {}
  }
  Linking.getInitialURL().then(handleAuthUrl)
  const sub = Linking.addEventListener('url', ({ url }) => { handleAuthUrl(url) })
  return () => sub.remove()
}

/** Google sign-in. Native: opens Google in an in-app browser that returns to unclekit://auth. Web: navigates away. */
export async function signInWithGoogle(): Promise<boolean> {
  const redirectTo = authRedirectUrl()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: Platform.OS !== 'web' },
  })
  if (error || !data?.url) return false
  if (Platform.OS === 'web') return true // browser is leaving for Google
  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
  if (res.type !== 'success') return false
  return handleAuthUrl(res.url)
}
