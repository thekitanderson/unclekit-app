import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, View,
} from 'react-native'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { registerForPush } from './lib/push'
import { Video } from './lib/Video'
import { listenForAuthLinks, signInWithGoogle } from './lib/authLink'

// No purchasing and no links to purchasing anywhere in the app. Membership is bought on unclekit.com.

type Tab = 'classroom' | 'posts' | 'leaderboard' | 'account'
type Course = { id: string; slug: string; title: string; description: string | null }
type Lesson = { id: string; title: string; body_md: string | null; course_id: string; video_id: string | null }

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    const stopLinks = listenForAuthLinks()
    return () => { sub.subscription.unsubscribe(); stopLinks() }
  }, [])

  if (!ready) return <Center><ActivityIndicator /></Center>
  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="dark" />
      {session ? <Member session={session} /> : <Login />}
    </SafeAreaView>
  )
}

function Login() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function google() {
    setBusy(true); setError(null)
    const ok = await signInWithGoogle()
    setBusy(false)
    if (!ok) setError('Sign-in didn\u2019t finish. Try again.')
  }

  return (
    <View style={s.pad}>
      <Text style={s.h1}>Uncle Kit</Text>
      <Btn testID="google" title={busy ? 'Opening Google\u2026' : 'Continue with Google'} onPress={google} disabled={busy} />
      {error && <Text testID="login-error" style={s.error}>{error}</Text>}
    </View>
  )
}

function Member({ session }: { session: Session }) {
  const userId = session.user.id
  const [rank, setRank] = useState<number | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [tab, setTab] = useState<Tab>('classroom')

  useEffect(() => {
    (async () => {
      const [{ data: r }, { data: a }] = await Promise.all([supabase.rpc('my_plan_rank'), supabase.rpc('is_admin')])
      setRank(typeof r === 'number' ? r : 0)
      setIsAdmin(a === true)
    })()
    registerForPush(userId).catch(() => {})
  }, [userId])

  if (rank === null) return <Center><ActivityIndicator /></Center>
  if (rank === 0 && !isAdmin) {
    return (
      <View style={s.pad}>
        <Text testID="inactive" style={s.h1}>Membership not active</Text>
        <Text style={s.p}>Manage your membership on unclekit.com.</Text>
        <Btn title="Log out" secondary onPress={() => supabase.auth.signOut()} />
      </View>
    )
  }
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        {tab === 'classroom' && <Classroom />}
        {tab === 'posts' && <Posts />}
        {tab === 'leaderboard' && <Leaderboard />}
        {tab === 'account' && <Account email={session.user.email ?? ''} />}
      </View>
      <View style={s.tabs}>
        {(['classroom', 'posts', 'leaderboard', 'account'] as Tab[]).map((t) => (
          <Pressable key={t} testID={`tab-${t}`} onPress={() => setTab(t)} style={s.tab}>
            <Text style={[s.tabText, tab === t && s.tabActive]}>{{ classroom: 'Classroom', posts: 'From Kit', leaderboard: 'Leaderboard', account: 'Account' }[t]}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

function Classroom() {
  const [courses, setCourses] = useState<Course[]>([])
  const [course, setCourse] = useState<Course | null>(null)
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [done, setDone] = useState<Set<string>>(new Set())
  const [lesson, setLesson] = useState<Lesson | null>(null)

  const loadCourses = useCallback(async () => {
    const { data } = await supabase.from('courses').select('id, slug, title, description').order('sort')
    setCourses(data ?? [])
  }, [])
  useEffect(() => {
    let live = true
    supabase.from('courses').select('id, slug, title, description').order('sort')
      .then(({ data }) => { if (live) setCourses(data ?? []) })
    return () => { live = false }
  }, [])

  async function openCourse(c: Course) {
    setCourse(c)
    const [{ data: ls }, { data: pr }] = await Promise.all([
      supabase.from('lessons').select('id, title, body_md, course_id, video_id').eq('course_id', c.id).order('sort'),
      supabase.from('lesson_progress').select('lesson_id'),
    ])
    setLessons(ls ?? [])
    setDone(new Set((pr ?? []).map((p) => p.lesson_id)))
  }
  async function complete(l: Lesson) {
    const { data: u } = await supabase.auth.getUser()
    const { error } = await supabase.from('lesson_progress').insert({ user_id: u.user!.id, lesson_id: l.id })
    if (!error || error.code === '23505') setDone(new Set([...done, l.id]))
  }

  if (lesson) {
    return (
      <ScrollView style={s.pad}>
        <Btn title="← Back" secondary onPress={() => setLesson(null)} />
        <Text testID="lesson-title" style={s.h1}>{lesson.title}</Text>
        {lesson.video_id ? <Video kind="lesson" id={lesson.id} /> : null}
        {lesson.body_md ? <Text style={s.p}>{lesson.body_md}</Text> : null}
        {done.has(lesson.id)
          ? <Text testID="completed" style={s.badge}>Completed</Text>
          : <Btn testID="mark-complete" title="Mark complete" onPress={() => complete(lesson)} />}
      </ScrollView>
    )
  }
  if (course) {
    return (
      <View style={s.pad}>
        <Btn title="← Classroom" secondary onPress={() => setCourse(null)} />
        <Text style={s.h1}>{course.title}</Text>
        <FlatList data={lessons} keyExtractor={(l) => l.id}
          ListEmptyComponent={<Text style={s.muted}>No lessons available.</Text>}
          renderItem={({ item }) => (
            <Pressable testID={`lesson-${item.title}`} onPress={() => setLesson(item)} style={s.row}>
              <Text style={s.rowText}>{item.title}{done.has(item.id) ? '  ✓' : ''}</Text>
            </Pressable>
          )} />
      </View>
    )
  }
  return (
    <View style={s.pad}>
      <Text style={s.h1}>Classroom</Text>
      <FlatList data={courses} keyExtractor={(c) => c.id}
        refreshControl={<RefreshControl refreshing={false} onRefresh={loadCourses} />}
        ListEmptyComponent={<Text style={s.muted}>No courses yet.</Text>}
        renderItem={({ item }) => (
          <Pressable testID={`course-${item.title}`} onPress={() => openCourse(item)} style={s.row}>
            <Text style={s.rowText}>{item.title}</Text>
            {item.description ? <Text style={s.muted}>{item.description}</Text> : null}
          </Pressable>
        )} />
    </View>
  )
}

function Posts() {
  const [posts, setPosts] = useState<{ id: string; title: string | null; body_md: string; created_at: string }[]>([])
  useEffect(() => {
    supabase.from('posts').select('id, title, body_md, created_at').order('pinned', { ascending: false })
      .order('created_at', { ascending: false }).limit(50).then(({ data }) => setPosts(data ?? []))
  }, [])
  return (
    <FlatList style={s.pad} data={posts} keyExtractor={(p) => p.id}
      ListHeaderComponent={<Text style={s.h1}>From Uncle Kit</Text>}
      ListEmptyComponent={<Text style={s.muted}>Nothing yet.</Text>}
      renderItem={({ item }) => (
        <View style={s.card}>
          {item.title ? <Text style={s.h2}>{item.title}</Text> : null}
          <Text style={s.p}>{item.body_md}</Text>
          <Text style={s.muted}>{new Date(item.created_at).toLocaleDateString('en-US')}</Text>
        </View>
      )} />
  )
}

function Leaderboard() {
  const [rows, setRows] = useState<{ id: string; display_name: string; handle: string; points: number; level: number }[]>([])
  const [names, setNames] = useState<Map<number, string>>(new Map())
  useEffect(() => {
    Promise.all([
      supabase.from('leaderboard').select('id, display_name, handle, points, level').limit(100),
      supabase.from('levels').select('level, name'),
    ]).then(([{ data: r }, { data: l }]) => {
      setRows(r ?? [])
      setNames(new Map((l ?? []).map((x) => [x.level, x.name])))
    })
  }, [])
  return (
    <FlatList style={s.pad} data={rows} keyExtractor={(r) => r.id}
      ListHeaderComponent={<Text style={s.h1}>Leaderboard</Text>}
      renderItem={({ item, index }) => (
        <View testID={`lb-${item.handle}`} style={s.row}>
          <Text style={s.rowText}>{index + 1}. {item.display_name} · {names.get(item.level) ?? `Level ${item.level}`} · {item.points}</Text>
        </View>
      )} />
  )
}

function Account({ email }: { email: string }) {
  return (
    <View style={s.pad}>
      <Text style={s.h1}>Account</Text>
      <Text style={s.p}>{email}</Text>
      <Text style={s.muted}>Manage your membership on unclekit.com.</Text>
      <Btn testID="logout" title="Log out" secondary onPress={() => supabase.auth.signOut()} />
    </View>
  )
}

function Btn({ title, onPress, disabled, secondary, testID }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} disabled={disabled}
      style={[s.btn, secondary && s.btnSecondary, disabled && { opacity: 0.5 }]}>
      <Text style={[s.btnText, secondary && { color: '#111' }]}>{title}</Text>
    </Pressable>
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'flex-start', padding: 20 }}>{children}</View>
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fafaf7' },
  pad: { padding: 20, flex: 1 },
  h1: { fontSize: 26, fontWeight: '800', marginVertical: 12, color: '#111', textAlign: 'left' },
  h2: { fontSize: 18, fontWeight: '700', marginBottom: 6 },
  p: { fontSize: 16, lineHeight: 23, marginVertical: 8, color: '#111' },
  muted: { color: '#666', marginVertical: 4 },
  label: { fontWeight: '600', marginTop: 8, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 12, fontSize: 16, backgroundColor: '#fff', marginBottom: 12 },
  error: { color: '#b3261e', marginTop: 10 },
  btn: { backgroundColor: '#111', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 6, alignSelf: 'flex-start', marginVertical: 6 },
  btnSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#111' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  row: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#ddd' },
  rowText: { fontSize: 16 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 14, marginVertical: 8 },
  video: { aspectRatio: 16 / 9, backgroundColor: '#222', borderRadius: 8, padding: 14, marginVertical: 12 },
  badge: { alignSelf: 'flex-start', backgroundColor: '#eee', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99, marginTop: 10 },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#ddd', backgroundColor: '#fff' },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabText: { color: '#666', fontWeight: '600' },
  tabActive: { color: '#111' },
})
