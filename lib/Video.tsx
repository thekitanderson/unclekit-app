import { createElement, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Platform, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { supabase } from './supabase'

const API = process.env.EXPO_PUBLIC_API_URL

const PLAYERJS_SRC = 'https://assets.mediadelivery.net/playerjs/playerjs-latest.min.js'

type PlayerJs = { Player: new (el: HTMLIFrameElement) => { on: (ev: string, cb: () => void) => void } }

function loadPlayerJs(): Promise<PlayerJs> {
  const w = window as unknown as { playerjs?: PlayerJs }
  if (w.playerjs) return Promise.resolve(w.playerjs)
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = PLAYERJS_SRC
    el.onload = () => (w.playerjs ? resolve(w.playerjs) : reject(new Error('player.js missing')))
    el.onerror = () => reject(new Error('player.js failed to load'))
    document.head.appendChild(el)
  })
}

/** Wraps the player in a page that reports "ended" back to the app (native). */
function playerPage(url: string) {
  const src = JSON.stringify(url)
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100%;height:100%}</style></head><body>
<iframe id="v" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>
<script>document.getElementById('v').src=${src};</script>
<script src="${PLAYERJS_SRC}"></script>
<script>var p=new playerjs.Player(document.getElementById('v'));p.on('ready',function(){p.on('ended',function(){window.ReactNativeWebView.postMessage('ended')})});</script>
</body></html>`
}

/** Asks the web backend for a signed, short-lived player URL. The backend checks membership and lesson order.
 *  onEnded fires once when the video plays to the end. */
export function Video({ kind, id, onEnded }: { kind: 'lesson' | 'post'; id: string; onEnded?: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const frame = useRef<HTMLIFrameElement | null>(null)
  const fired = useRef(false)
  const ended = useRef(onEnded)
  useEffect(() => { ended.current = onEnded }, [onEnded])
  const fire = () => { if (!fired.current && ended.current) { fired.current = true; ended.current() } }

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

  useEffect(() => {
    if (Platform.OS !== 'web' || !url || !frame.current) return
    let live = true
    loadPlayerJs().then((pj) => {
      if (!live || !frame.current) return
      const player = new pj.Player(frame.current)
      player.on('ready', () => player.on('ended', fire))
    }).catch(() => { /* video still plays; completion just won't auto-record */ })
    return () => { live = false }
  }, [url])

  const box = { aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 8, overflow: 'hidden' as const, marginVertical: 12 }
  if (err) return <View testID="video-error" style={[box, { padding: 14 }]}><Text style={{ color: '#aaa' }}>{err}</Text></View>
  if (!url) return <View style={[box, { justifyContent: 'center' }]}><ActivityIndicator /></View>
  if (Platform.OS === 'web') {
    return <View testID="video" style={box}>{createElement('iframe', { ref: frame, src: url, title: 'Video', allow: 'encrypted-media; picture-in-picture; fullscreen', allowFullScreen: true, style: { width: '100%', height: '100%', border: 0 } })}</View>
  }
  return (
    <View testID="video" style={box}>
      <WebView source={{ html: playerPage(url), baseUrl: API }} originWhitelist={['*']} onMessage={(e) => { if (e.nativeEvent.data === 'ended') fire() }}
        allowsFullscreenVideo allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} />
    </View>
  )
}
