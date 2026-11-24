import { createElement, useEffect, useState } from 'react'
import { ActivityIndicator, Platform, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { supabase } from './supabase'

const API = process.env.EXPO_PUBLIC_API_URL

/** Asks the web backend for a signed, short-lived player URL. The backend checks membership via RLS. */
export function Video({ kind, id }: { kind: 'lesson' | 'post'; id: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        if (!API || !token) throw new Error('not configured')
        const r = await fetch(`${API}/api/video?${kind}=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } })
        const j = await r.json()
        if (!r.ok || !j.url) throw new Error(j.error ?? 'unavailable')
        if (live) setUrl(j.url)
      } catch {
        if (live) setErr('Video unavailable right now.')
      }
    })()
    return () => { live = false }
  }, [kind, id])

  const box = { aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 8, overflow: 'hidden' as const, marginVertical: 12 }
  if (err) return <View testID="video-error" style={[box, { padding: 14 }]}><Text style={{ color: '#aaa' }}>{err}</Text></View>
  if (!url) return <View style={[box, { justifyContent: 'center' }]}><ActivityIndicator /></View>
  if (Platform.OS === 'web') {
    return <View testID="video" style={box}>{createElement('iframe', { src: url, title: 'Video', allow: 'encrypted-media; picture-in-picture; fullscreen', allowFullScreen: true, style: { width: '100%', height: '100%', border: 0 } })}</View>
  }
  return (
    <View testID="video" style={box}>
      <WebView source={{ uri: url }} allowsFullscreenVideo allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} />
    </View>
  )
}
