import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

type Reminder = {
  id: string
  position: 'LEFT' | 'RIGHT' | 'SUPINE'
  scheduled_at: string
  unlock_at: string
  followup_at: string
  completed_at: string | null
  initial_notification_sent_at: string | null
  followup_notification_sent_at: string | null
}

const positionLabel: Record<Reminder['position'], string> = {
  LEFT: 'ตะแคงซ้าย',
  RIGHT: 'ตะแคงขวา',
  SUPINE: 'นอนหงาย'
}

const formatter = new Intl.DateTimeFormat('th-TH', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Bangkok'
})

function waitLabel(unlockAt: string, now: number) {
  const seconds = Math.max(0, Math.ceil((new Date(unlockAt).getTime() - now) / 1000))
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `กดเสร็จแล้วได้ใน ${minutes}:${String(rest).padStart(2, '0')} นาที`
}

export default function ReminderPanel() {
  const [items, setItems] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [now, setNow] = useState(Date.now())
  const targetId = useMemo(() => new URLSearchParams(window.location.search).get('reminder'), [])

  const load = useCallback(async () => {
    if (!supabase) return
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const to = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const { data, error: queryError } = await supabase
      .from('reminder_instances')
      .select('id,position,scheduled_at,unlock_at,followup_at,completed_at,initial_notification_sent_at,followup_notification_sent_at')
      .gte('scheduled_at', from)
      .lte('scheduled_at', to)
      .order('scheduled_at', { ascending: false })
      .limit(24)
    if (queryError) setError(queryError.message)
    else { setItems((data ?? []) as Reminder[]); setError('') }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    const queryTimer = window.setInterval(() => void load(), 60_000)
    const clockTimer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => {
      window.clearInterval(queryTimer)
      window.clearInterval(clockTimer)
    }
  }, [load])

  async function complete(reminder: Reminder) {
    if (!supabase) return
    setBusyId(reminder.id); setError(''); setNotice('')
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('reminder-engine', {
        body: { action: 'complete', reminder_id: reminder.id }
      })
      if (invokeError) throw invokeError
      if (data?.result === 'locked') {
        setNotice('ยังไม่ครบ 10 นาที ระบบยังไม่เปิดให้กดเสร็จแล้ว')
      } else if (data?.result === 'completed') {
        setNotice('บันทึกว่าเสร็จแล้ว')
      } else {
        setError('ไม่พบรายการเตือนนี้ หรือไม่มีสิทธิ์ดำเนินการ')
      }
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'บันทึกไม่สำเร็จ กรุณาลองใหม่')
    } finally { setBusyId('') }
  }

  return <section className="reminder-panel">
    <div className="reminder-title">
      <div>
        <h3>การเตือนของฉัน</h3>
        <p className="muted">รายการเตือนส่วนบุคคลในช่วง 24 ชั่วโมงล่าสุด</p>
      </div>
      <button className="secondary compact" onClick={() => void load()} disabled={loading}>รีเฟรช</button>
    </div>

    {loading ? <p role="status">กำลังโหลดรายการเตือน…</p> :
      items.length === 0 ? <p className="muted">ยังไม่มีรายการเตือนในช่วงนี้</p> :
      <div className="reminder-list">
        {items.map(item => {
          const unlock = new Date(item.unlock_at).getTime()
          const completed = Boolean(item.completed_at)
          const locked = !completed && now < unlock
          const highlighted = item.id === targetId
          return <article key={item.id} className={`reminder-item${highlighted ? ' reminder-highlight' : ''}`}>
            <div className="reminder-row">
              <div>
                <strong>{positionLabel[item.position]}</strong>
                <div className="muted">{formatter.format(new Date(item.scheduled_at))}</div>
              </div>
              <span className={`reminder-state ${completed ? 'done' : locked ? 'locked' : 'ready'}`}>
                {completed ? 'เสร็จแล้ว' : locked ? 'รอครบ 10 นาที' : 'พร้อมดำเนินการ'}
              </span>
            </div>
            {locked && <p className="reminder-countdown">{waitLabel(item.unlock_at, now)}</p>}
            {!completed && item.followup_notification_sent_at && <p className="reminder-followup">ส่งการเตือนซ้ำแล้ว</p>}
            {completed && item.completed_at && <p className="muted">บันทึกเมื่อ {formatter.format(new Date(item.completed_at))}</p>}
            <button
              disabled={completed || locked || busyId === item.id}
              onClick={() => void complete(item)}
            >
              {completed ? 'บันทึกแล้ว' : busyId === item.id ? 'กำลังบันทึก…' : 'เสร็จแล้ว'}
            </button>
          </article>
        })}
      </div>}

    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
  </section>
}
