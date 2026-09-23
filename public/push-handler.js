self.addEventListener('push', event => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch { payload = { body: event.data ? event.data.text() : '' } }
  const title = payload.title || 'นาฬิกาพลิกตะแคงตัว'
  const options = {
    body: payload.body || 'มีการแจ้งเตือนใหม่',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag || 'turning-reminder',
    data: { url: payload.url || '/' }
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/'
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if ('focus' in client) {
        if ('navigate' in client) await client.navigate(url)
        return client.focus()
      }
    }
    return self.clients.openWindow(url)
  })())
})
