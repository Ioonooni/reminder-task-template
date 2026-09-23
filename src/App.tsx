import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configured, supabase, type Profile } from './supabase'
import Roster from './Roster'
import PushNotifications from './PushNotifications'
import ReminderPanel from './ReminderPanel'

const roleName = (role: Profile['role']) => role === 'head_nurse' ? 'หัวหน้าพยาบาล' : 'พยาบาล'
const RESEND_WAIT_SECONDS = 60
const pendingEmailKey = 'patient-turning-pending-email'
const resendAtKey = 'patient-turning-resend-at'

function authMessage(cause: unknown) {
  const message = cause instanceof Error ? cause.message : ''
  if (/rate limit|too many requests|email rate limit/i.test(message)) return 'ส่งรหัสถี่เกินไป กรุณารอสักครู่แล้วลองใหม่'
  if (/expired|invalid|otp/i.test(message)) return 'รหัสไม่ถูกต้องหรือหมดอายุ กรุณาตรวจสอบรหัสล่าสุด หรือขอรหัสใหม่'
  return message || 'ไม่สามารถดำเนินการได้ กรุณาลองใหม่'
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [mode, setMode] = useState<'login' | 'signup' | 'verify'>(() => sessionStorage.getItem(pendingEmailKey) ? 'verify' : 'login')
  const [pendingEmail, setPendingEmail] = useState(() => sessionStorage.getItem(pendingEmailKey) ?? '')
  const [otp, setOtp] = useState('')
  const [resendAt, setResendAt] = useState(() => Number(sessionStorage.getItem(resendAtKey)) || 0)
  const [now, setNow] = useState(Date.now())
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')

  useEffect(() => {
    if (mode !== 'verify' || resendAt <= Date.now()) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [mode, resendAt])

  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000))
  function startResendWait() {
    const until = Date.now() + RESEND_WAIT_SECONDS * 1000
    sessionStorage.setItem(resendAtKey, String(until))
    setResendAt(until)
    setNow(Date.now())
  }
  function clearVerification() {
    sessionStorage.removeItem(pendingEmailKey)
    sessionStorage.removeItem(resendAtKey)
    setPendingEmail('')
    setOtp('')
    setResendAt(0)
  }

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    let active = true
    const client = supabase
    void client.auth.getSession().then(({ data, error: authError }) => {
      if (active) { setSession(data.session); setError(authError?.message ?? ''); setLoading(false) }
    })
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setProfile(null)
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!session || !supabase) return
    let active = true
    const client = supabase
    void client.from('profiles').select('id,first_name,last_name,role,department_id')
      .eq('id', session.user.id).single().then(({ data, error: queryError }) => {
        if (active) { setProfile(data as Profile | null); setFirstName(data?.first_name ?? ''); setLastName(data?.last_name ?? ''); setError(queryError?.message ?? '') }
      })
    return () => { active = false }
  }, [session])

  async function submitAuth(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (mode === 'signup') {
        const normalizedEmail = email.trim().toLowerCase()
        const { data, error: authError } = await supabase.auth.signUp({
          email: normalizedEmail, password, options: { data: { first_name: firstName.trim(), last_name: lastName.trim() } }
        })
        if (authError) throw authError
        if (data.session) { setNotice('สร้างบัญชีสำเร็จ'); return }
        sessionStorage.setItem(pendingEmailKey, normalizedEmail)
        setPendingEmail(normalizedEmail)
        setPassword('')
        setOtp('')
        setMode('verify')
        startResendWait()
        setNotice('ส่งรหัสยืนยัน 6 หลักไปที่อีเมลแล้ว กรุณาตรวจสอบกล่องจดหมาย')
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
        if (authError) throw authError
      }
    } catch (cause) { setError(authMessage(cause)) }
    finally { setBusy(false) }
  }

  async function verifyEmail(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !/^\d{6}$/.test(otp)) return
    setBusy(true); setError(''); setNotice('')
    const { data, error: authError } = await supabase.auth.verifyOtp({ email: pendingEmail, token: otp, type: 'email' })
    if (authError) setError(authMessage(authError))
    else if (data.session) { clearVerification(); setNotice('ยืนยันอีเมลสำเร็จ'); setMode('login') }
    else setError('ยืนยันอีเมลแล้ว แต่ยังเข้าสู่ระบบไม่ได้ กรุณาเข้าสู่ระบบด้วยอีเมลและรหัสผ่าน')
    setBusy(false)
  }

  async function resendOtp() {
    if (!supabase || busy || remaining > 0 || !pendingEmail) return
    setBusy(true); setError(''); setNotice('')
    // Apply the wait before the request to prevent accidental repeated clicks, including server rate limits.
    startResendWait()
    const { error: authError } = await supabase.auth.resend({ type: 'signup', email: pendingEmail })
    if (authError) setError(authMessage(authError))
    else { setOtp(''); setNotice('ส่งรหัสใหม่แล้ว กรุณาใช้รหัสจากอีเมลฉบับล่าสุด') }
    setBusy(false)
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !profile) return
    setBusy(true); setError(''); setNotice('')
    const { data, error: updateError } = await supabase.from('profiles')
      .update({ first_name: firstName.trim(), last_name: lastName.trim() })
      .eq('id', profile.id).select('id,first_name,last_name,role,department_id').single()
    if (updateError) setError(updateError.message)
    else { setProfile(data as Profile); setNotice('บันทึกข้อมูลแล้ว') }
    setBusy(false)
  }

  if (!configured) return <main className="shell"><section className="card"><h1>นาฬิกาพลิกตะแคงตัว</h1><p>ยังไม่ได้ตั้งค่าการเชื่อมต่อ Supabase สำหรับหน่วยงานนี้</p></section></main>
  return <main className="shell"><section className={`card ${session && profile ? 'card-wide' : ''}`}>
    <div className="brand"><div className="mark">◷</div><div><h1>นาฬิกาพลิกตะแคงตัว</h1><p>สำหรับบุคลากรพยาบาล</p></div></div>
    {loading ? <p role="status">กำลังตรวจสอบบัญชี…</p> : session ? <>
      {profile ? <>
        <div className="badge">{roleName(profile.role)}</div>
        <h2>สวัสดี {profile.first_name} {profile.last_name}</h2>
        <p className="muted">อีเมล: {session.user.email}</p>
        <form onSubmit={saveProfile}>
          <label>ชื่อ<input required maxLength={100} value={firstName} onChange={e => setFirstName(e.target.value)} /></label>
          <label>นามสกุล<input required maxLength={100} value={lastName} onChange={e => setLastName(e.target.value)} /></label>
          <button disabled={busy}>บันทึกชื่อ</button>
        </form>
        <Roster profile={profile} />
        <PushNotifications userId={profile.id} />
        <ReminderPanel />
      </> : !error ? <p role="status">กำลังโหลดข้อมูลผู้ใช้…</p> : <button onClick={() => window.location.reload()}>ลองโหลดข้อมูลอีกครั้ง</button>}
      <button className="secondary" disabled={busy} onClick={async () => { setError(''); const { error: signoutError } = await supabase!.auth.signOut(); if (signoutError) setError(signoutError.message) }}>ออกจากระบบ</button>
    </> : <>
      <h2>{mode === 'login' ? 'เข้าสู่ระบบ' : mode === 'signup' ? 'สร้างบัญชีพยาบาล' : 'ยืนยันอีเมล'}</h2>
      {mode === 'verify' ? <>
        <p className="muted">กรอกรหัส 6 หลักที่ส่งไปยัง <strong>{pendingEmail}</strong></p>
        <form onSubmit={verifyEmail}>
          <label>รหัสยืนยัน<input required autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" /></label>
          <button disabled={busy || otp.length !== 6}>{busy ? 'กำลังยืนยัน…' : 'ยืนยันรหัส'}</button>
        </form>
        <button className="secondary" disabled={busy || remaining > 0} onClick={resendOtp}>{remaining > 0 ? `ขอรหัสใหม่ได้ใน ${remaining} วินาที` : 'ส่งรหัสใหม่'}</button>
        <button className="link" onClick={() => { clearVerification(); setMode('login'); setError(''); setNotice('') }}>กลับไปเข้าสู่ระบบ</button>
      </> : <><form onSubmit={submitAuth}>
        {mode === 'signup' && <><label>ชื่อ<input required maxLength={100} autoComplete="given-name" value={firstName} onChange={e => setFirstName(e.target.value)} /></label><label>นามสกุล<input required maxLength={100} autoComplete="family-name" value={lastName} onChange={e => setLastName(e.target.value)} /></label></>}
        <label>อีเมล<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>รหัสผ่าน<input required minLength={6} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} /></label>
        <button disabled={busy}>{busy ? 'กำลังดำเนินการ…' : mode === 'login' ? 'เข้าสู่ระบบ' : 'สร้างบัญชี'}</button>
      </form>
      <button className="link" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setNotice('') }}>{mode === 'login' ? 'ยังไม่มีบัญชี? สร้างบัญชี' : 'มีบัญชีแล้ว? เข้าสู่ระบบ'}</button></>}
    </>}
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    <footer className="creator-credit">Created by <a href="https://github.com/Ioonooni/reminder-task-template" target="_blank" rel="noreferrer">IOON</a></footer>
  </section></main>
}
