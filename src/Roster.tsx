import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase, type Profile } from './supabase'

type Shift = { id: string; code: 'MORNING' | 'EVENING' | 'NIGHT'; starts_at: string; ends_at: string }
type Entry = { id: string; user_id: string; shift_type_id: string; shift_date: string }
const shiftNames: Record<Shift['code'], string> = { MORNING: 'เช้า', EVENING: 'บ่าย', NIGHT: 'ดึก' }
const dateFormat = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { day: 'numeric', month: 'short', year: 'numeric', weekday: 'short', timeZone: 'UTC' })

function addDays(day: string, count: number) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}
function bangkokToday() {
  const parts = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Bangkok' }).formatToParts(new Date())
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
function labelDate(day: string) { return dateFormat.format(new Date(`${day}T00:00:00Z`)) }
function personLabel(person: Profile) { return `${person.first_name} ${person.last_name} (${person.id.slice(0, 8)})` }
function message(error: { code?: string; message: string }) {
  if (error.code === '23505') return 'มีเวรเดียวกันในวันนี้อยู่แล้ว'
  if (error.code === '42501') return 'ไม่มีสิทธิ์แก้ไขเวรนี้'
  if (error.code === '23503') return 'ข้อมูลบุคลากรหรือเวรไม่ตรงกับหน่วยงาน'
  return error.message
}

export default function Roster({ profile }: { profile: Profile }) {
  const headNurse = profile.role === 'head_nurse'
  const [start, setStart] = useState(bangkokToday)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [people, setPeople] = useState<Profile[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedUser, setSelectedUser] = useState(profile.id)
  const [selectedDate, setSelectedDate] = useState(start)
  const [selectedShift, setSelectedShift] = useState('')
  const [filterShift, setFilterShift] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editShift, setEditShift] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    if (!supabase) return
    let active = true
    const client = supabase
    const end = addDays(start, 29)
    void (async () => {
      setLoading(true); setError('')
      const [shiftResult, peopleResult, entryResult] = await Promise.all([
        client.from('shift_types').select('id,code,starts_at,ends_at').eq('department_id', profile.department_id).order('starts_at'),
        headNurse ? client.from('profiles').select('id,first_name,last_name,role,department_id').eq('department_id', profile.department_id).order('first_name') : Promise.resolve({ data: [profile], error: null }),
        client.from('roster_entries').select('id,user_id,shift_type_id,shift_date').eq('department_id', profile.department_id).gte('shift_date', start).lte('shift_date', end).order('shift_date')
      ])
      if (!active) return
      const failure = shiftResult.error ?? peopleResult.error ?? entryResult.error
      if (failure) { setError(message(failure)); setEntries([]); setPeople([]); setShifts([]) }
      else {
        setShifts(shiftResult.data as Shift[])
        setPeople(peopleResult.data as Profile[])
        setEntries(entryResult.data as Entry[])
      }
      setLoading(false)
    })()
    return () => { active = false }
  }, [profile, headNurse, start, refresh])

  const dates = useMemo(() => Array.from({ length: 30 }, (_, i) => addDays(start, i)), [start])
  const end = dates[29]
  const peopleById = useMemo(() => new Map(people.map(person => [person.id, person])), [people])
  const shiftsById = useMemo(() => new Map(shifts.map(shift => [shift.id, shift])), [shifts])
  const visible = entries.filter(entry => (!filterShift || entry.shift_type_id === filterShift) && (headNurse || entry.user_id === profile.id))
  function reload() { setRefresh(current => current + 1) }

  async function addEntry(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !selectedShift || selectedDate < start || selectedDate > end) return
    setBusy(true); setError(''); setNotice('')
    const { error: problem } = await supabase.from('roster_entries').insert({
      user_id: headNurse ? selectedUser : profile.id,
      department_id: profile.department_id,
      shift_type_id: selectedShift,
      shift_date: selectedDate
    })
    if (problem) setError(message(problem))
    else { setNotice('เพิ่มเวรแล้ว'); reload() }
    setBusy(false)
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !editId || !editShift || editDate < start || editDate > end) return
    setBusy(true); setError(''); setNotice('')
    const { data, error: problem } = await supabase.from('roster_entries')
      .update({ shift_date: editDate, shift_type_id: editShift }).eq('id', editId)
      .select('id')
    if (problem) setError(message(problem))
    else if (!data?.length) setError('ไม่พบเวรที่แก้ไขได้ กรุณาโหลดข้อมูลใหม่')
    else { setEditId(null); setNotice('แก้ไขเวรแล้ว'); reload() }
    setBusy(false)
  }

  async function removeEntry(entry: Entry) {
    if (!supabase || !window.confirm(`ลบเวรวันที่ ${labelDate(entry.shift_date)}?`)) return
    setBusy(true); setError(''); setNotice('')
    const { data, error: problem } = await supabase.from('roster_entries').delete().eq('id', entry.id).select('id')
    if (problem) setError(message(problem))
    else if (!data?.length) setError('ไม่พบเวรที่ลบได้ กรุณาโหลดข้อมูลใหม่')
    else { setNotice('ลบเวรแล้ว'); reload() }
    setBusy(false)
  }

  return <section className="roster" aria-label="ตารางเวร">
    <h2>{headNurse ? 'ภาพรวมเวรของหน่วยงาน' : 'ตารางเวรของฉัน'}</h2>
    <p className="muted">แสดง 30 วันตามวันของประเทศไทย • {labelDate(start)} – {labelDate(end)}</p>
    <div className="roster-controls">
      <label>เริ่มวันที่<input type="date" value={start} onChange={event => { const day = event.target.value; if (day) { setStart(day); setSelectedDate(day); setEditId(null) } }} /></label>
      <button type="button" className="secondary" onClick={() => { const today = bangkokToday(); setStart(today); setSelectedDate(today) }}>กลับวันนี้</button>
      <button type="button" className="secondary" onClick={reload}>โหลดเวรใหม่</button>
    </div>
    {loading ? <p role="status">กำลังโหลดตารางเวร…</p> : <>
      <form onSubmit={addEntry} className="roster-form">
        <h3>เพิ่มเวร</h3>
        {headNurse && <label>พยาบาล<select value={selectedUser} onChange={event => setSelectedUser(event.target.value)}>{people.map(person => <option key={person.id} value={person.id}>{personLabel(person)}</option>)}</select></label>}
        <label>วันที่<input required type="date" min={start} max={end} value={selectedDate} onChange={event => setSelectedDate(event.target.value)} /></label>
        <label>เวร<select required value={selectedShift} onChange={event => setSelectedShift(event.target.value)}><option value="">เลือกเวร</option>{shifts.map(shift => <option key={shift.id} value={shift.id}>{shiftNames[shift.code]} ({shift.starts_at.slice(0, 5)}–{shift.ends_at.slice(0, 5)})</option>)}</select></label>
        <button disabled={busy || !selectedShift || (headNurse && !peopleById.has(selectedUser))}>เพิ่มเวร</button>
      </form>
      {headNurse && <label>ดูเฉพาะเวร<select value={filterShift} onChange={event => setFilterShift(event.target.value)}><option value="">ทุกเวร</option>{shifts.map(shift => <option key={shift.id} value={shift.id}>{shiftNames[shift.code]}</option>)}</select></label>}
      <div className="days">{dates.map(day => {
        const dayEntries = visible.filter(entry => entry.shift_date === day)
        return <div key={day} className="day"><div className="day-heading"><strong>{labelDate(day)}</strong><span>{dayEntries.length} เวร</span></div>
          {dayEntries.length ? dayEntries.map(entry => {
            const shift = shiftsById.get(entry.shift_type_id)
            const person = peopleById.get(entry.user_id)
            return <div key={entry.id} className="entry">
              {editId === entry.id ? <form onSubmit={saveEdit} className="entry-edit">
                <label>วันที่<input required type="date" min={start} max={end} value={editDate} onChange={event => setEditDate(event.target.value)} /></label>
                <label>เวร<select required value={editShift} onChange={event => setEditShift(event.target.value)}>{shifts.map(item => <option key={item.id} value={item.id}>{shiftNames[item.code]}</option>)}</select></label>
                <button disabled={busy}>บันทึกเวร</button><button type="button" className="link" onClick={() => setEditId(null)}>ยกเลิก</button>
              </form> : <><span>{headNurse ? `${person ? personLabel(person) : 'ไม่พบชื่อ'} · ` : ''}{shift ? shiftNames[shift.code] : 'ไม่พบเวร'}</span>
                <div className="entry-actions"><button type="button" className="secondary" disabled={busy} onClick={() => { setEditId(entry.id); setEditDate(entry.shift_date); setEditShift(entry.shift_type_id) }}>แก้ไข</button><button type="button" className="secondary" disabled={busy} onClick={() => void removeEntry(entry)}>ลบ</button></div></>}
            </div>
          }) : <p className="muted">ไม่มีเวร</p>}
        </div>
      })}</div>
    </>}
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
  </section>
}
