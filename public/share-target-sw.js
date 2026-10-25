// Receives a video shared to the app from Android's share menu (manifest share_target).
// The video is parked in Cache Storage and the app is opened with ?shared=1 to pick it up.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/share-target')) return;
  const base = url.pathname.slice(0, -'share-target'.length);
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const file = form.get('video');
        if (file && typeof file !== 'string') {
          const cache = await caches.open('shared-video');
          await cache.put(
            'shared',
            new Response(file, {
              headers: {
                'Content-Type': file.type || 'video/mp4',
                'X-File-Name': encodeURIComponent(file.name || 'shared-video.mp4'),
              },
            }),
          );
          return Response.redirect(`${base}?shared=1`, 303);
        }
      } catch (err) {
        console.error('Share target failed', err);
      }
      return Response.redirect(`${base}?shared=error`, 303);
    })(),
  );
});
