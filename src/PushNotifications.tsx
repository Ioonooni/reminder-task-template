import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

type State = 'checking' | 'unsupported' | 'needs_install' | 'default' | 'denied' | 'enabled' | 'disabled'

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)))
}

function arrayBufferToBase64Url(value: ArrayBuffer | null) {
  if (!value) return ''
  const bytes = new Uint8Array(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
}

export default function PushNotifications({ userId }: { userId: string }) {
  const [state, setState] = useState<State>('checking')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const supported = useMemo(() =>
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  , [])

  useEffect(() => {
    let active = true
    async function inspect() {
      if (!supported) { if (active) setState('unsupported'); return }
      if (isIosDevice() && !isStandalone()) { if (active) setState('needs_install'); return }
      if (Notification.permission === 'denied') { if (active) setState('denied'); return }
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (!subscription) { if (active) setState(Notification.permission === 'granted' ? 'disabled' : 'default'); return }
      const { data } = await supabase!.from('push_subscriptions')
        .select('id,active')
        .eq('endpoint', subscription.endpoint)
        .maybeSingle()
      if (active) setState(data?.active ? 'enabled' : 'disabled')
    }
    void inspect().catch(() => { if (active) setState('disabled') })
    return () => { active = false }
  }, [supported, userId])

  async function publicKey() {
    const { data, error } = await supabase!.from('push_config')
      .select('vapid_public_key')
      .eq('id', true)
      .single()
    if (error || !data?.vapid_public_key) throw error ?? new Error('ไม่พบ public key สำหรับ push')
    if (data.vapid_public_key === 'UNCONFIGURED') {
      throw new Error('ระบบแจ้งเตือนของหน่วยงานนี้ยังตั้งค่าไม่เสร็จ กรุณาติดต่อผู้ดูแลระบบ')
    }
    return data.vapid_public_key as string
  }

  async function persist(subscription: PushSubscription) {
    const p256dh = arrayBufferToBase64Url(subscription.getKey('p256dh'))
    const auth = arrayBufferToBase64Url(subscription.getKey('auth'))
    const payload = {
      user_id: userId,
      endpoint: subscription.endpoint,
      public_key: p256dh,
      auth_key: auth,
      user_agent: navigator.userAgent.slice(0, 500),
      active: true,
      last_seen_at: new Date().toISOString()
    }

    const { data: own } = await supabase!.from('push_subscriptions')
      .select('id')
      .eq('endpoint', subscription.endpoint)
      .maybeSingle()

    if (own) {
      const { error } = await supabase!.from('push_subscriptions')
        .update({
          public_key: p256dh,
          auth_key: auth,
          user_agent: payload.user_agent,
          active: true,
          last_seen_at: payload.last_seen_at
        })
        .eq('id', own.id)
      if (error) throw error
      return
    }

    const { error } = await supabase!.from('push_subscriptions').insert(payload)
    if (!error) return
    if (error.code !== '23505') throw error

    // The origin can retain a subscription created under a different login.
    // Unsubscribe and create a fresh endpoint so the device is never associated
    // with the wrong account.
    await subscription.unsubscribe()
    const registration = await navigator.serviceWorker.ready
    const fresh = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(await publicKey())
    })
    const freshPayload = {
      ...payload,
      endpoint: fresh.endpoint,
      public_key: arrayBufferToBase64Url(fresh.getKey('p256dh')),
      auth_key: arrayBufferToBase64Url(fresh.getKey('auth'))
    }
    const { error: freshError } = await supabase!.from('push_subscriptions').insert(freshPayload)
    if (freshError) throw freshError
  }

  async function enable() {
    setBusy(true); setMessage('')
    try {
      if (!supported) { setState('unsupported'); return }
      if (isIosDevice() && !isStandalone()) { setState('needs_install'); return }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'default')
        return
      }
      const registration = await navigator.serviceWorker.ready
      let subscription = await registration.pushManager.getSubscription()
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(await publicKey())
        })
      }
      await persist(subscription)
      setState('enabled')
      setMessage('เปิดการแจ้งเตือนบนเครื่องนี้แล้ว')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'เปิดการแจ้งเตือนไม่สำเร็จ')
    } finally { setBusy(false) }
  }

  async function disable() {
    setBusy(true); setMessage('')
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await supabase!.from('push_subscriptions')
          .update({ active: false, last_seen_at: new Date().toISOString() })
          .eq('endpoint', subscription.endpoint)
        await subscription.unsubscribe()
      }
      setState('disabled')
      setMessage('ปิดการแจ้งเตือนบนเครื่องนี้แล้ว')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'ปิดการแจ้งเตือนไม่สำเร็จ')
    } finally { setBusy(false) }
  }

  async function testPush() {
    setBusy(true); setMessage('')
    try {
      const { data, error } = await supabase!.functions.invoke('test-push', { body: {} })
      if (error) throw error
      const sent = Number(data?.sent ?? 0)
      setMessage(sent > 0 ? 'ส่งการแจ้งเตือนทดสอบแล้ว กรุณาดูการแจ้งเตือนบนเครื่อง' : 'ไม่พบ subscription ที่พร้อมส่งบนบัญชีนี้')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'ส่งการแจ้งเตือนทดสอบไม่สำเร็จ')
    } finally { setBusy(false) }
  }

  const label = state === 'enabled' ? 'พร้อมรับการแจ้งเตือน'
    : state === 'denied' ? 'การแจ้งเตือนถูกปฏิเสธ'
    : state === 'needs_install' ? 'ต้องติดตั้ง PWA ก่อน'
    : state === 'unsupported' ? 'เบราว์เซอร์นี้ไม่รองรับ Web Push'
    : 'ยังไม่ได้เปิดการแจ้งเตือน'

  return <section className="push-panel">
    <h3>การแจ้งเตือนบนเครื่องนี้</h3>
    <div className="push-status">
      <strong className={state === 'enabled' ? 'status-ok' : 'status-warn'}>{label}</strong>
    </div>
    {state === 'needs_install' && <p className="push-help">บน iPhone ให้กด Share → Add to Home Screen แล้วเปิดแอปจากไอคอนบนหน้าจอโฮมก่อนเปิดการแจ้งเตือน</p>}
    {state === 'denied' && <p className="push-help">กรุณาเปิดสิทธิ์ Notifications ของแอปนี้จากการตั้งค่าของอุปกรณ์ แล้วกลับมาเปิดการแจ้งเตือนอีกครั้ง</p>}
    <div className="push-actions">
      {state !== 'enabled' ? <button disabled={busy || state === 'unsupported'} onClick={enable}>เปิดการแจ้งเตือน</button>
        : <button className="secondary" disabled={busy} onClick={disable}>ปิดการแจ้งเตือนบนเครื่องนี้</button>}
      <button disabled={busy || state !== 'enabled'} onClick={testPush}>ส่ง Test Push</button>
    </div>
    {message && <p className="notice" role="status">{message}</p>}
  </section>
}
