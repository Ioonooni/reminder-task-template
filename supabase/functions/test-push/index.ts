import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2.57.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function envKey(name: 'SUPABASE_PUBLISHABLE_KEYS' | 'SUPABASE_SECRET_KEYS', fallback: string) {
  const raw = Deno.env.get(name)
  if (raw) {
    const parsed = JSON.parse(raw)
    if (parsed.default) return parsed.default as string
  }
  const value = Deno.env.get(fallback)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: cors })

  try {
    const authorization = req.headers.get('Authorization') ?? ''
    const token = authorization.replace(/^Bearer\s+/i, '')
    if (!token) return Response.json({ error: 'unauthorized' }, { status: 401, headers: cors })

    const url = Deno.env.get('SUPABASE_URL')!
    const publishable = envKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
    const secret = envKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')

    const userClient = createClient(url, publishable, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser(token)
    if (userError || !user) return Response.json({ error: 'unauthorized' }, { status: 401, headers: cors })

    const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
    const [{ data: publicKey, error: pubError }, { data: privateKey, error: privError }] = await Promise.all([
      admin.rpc('get_vapid_public_key_for_backend'),
      admin.rpc('get_vapid_private_key_for_backend')
    ])
    if (pubError || privError || !publicKey || !privateKey) throw pubError ?? privError ?? new Error('VAPID keys unavailable')

    const { data: subscriptions, error: subError } = await admin
      .from('push_subscriptions')
      .select('id,endpoint,public_key,auth_key')
      .eq('user_id', user.id)
      .eq('active', true)
    if (subError) throw subError

    webpush.setVapidDetails('https://github.com/Ioonooni/reminder-task-template', publicKey, privateKey)

    let sent = 0
    let expired = 0
    const payload = JSON.stringify({
      title: 'ทดสอบการแจ้งเตือน',
      body: 'หากเห็นข้อความนี้ แสดงว่าการแจ้งเตือนบนเครื่องนี้ทำงานแล้ว',
      tag: 'v1p3-test-push',
      url: '/'
    })

    for (const sub of subscriptions ?? []) {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.public_key, auth: sub.auth_key }
        }, payload, { TTL: 60 })
        sent += 1
      } catch (cause) {
        const statusCode = Number((cause as { statusCode?: number }).statusCode ?? 0)
        if (statusCode === 404 || statusCode === 410) {
          expired += 1
          await admin.from('push_subscriptions')
            .update({ active: false, last_seen_at: new Date().toISOString() })
            .eq('id', sub.id)
        } else {
          console.error('web-push failed', statusCode || 'unknown')
        }
      }
    }

    return Response.json({ sent, expired }, { headers: cors })
  } catch (cause) {
    console.error(cause)
    return Response.json({ error: 'test_push_failed' }, { status: 500, headers: cors })
  }
})
