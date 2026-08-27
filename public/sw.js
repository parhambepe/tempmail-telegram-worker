// Minimal service worker: only caches the app shell so the PWA installs and
// opens instantly. API responses are always fetched from the network.

const CACHE = "tempmail-shell-v1"
const SHELL = ["/", "/index.html", "/app.css", "/app.js", "/manifest.webmanifest"]

self.addEventListener("install", (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
			.then(() => self.clients.claim()),
	)
})

self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url)
	if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) return
	event.respondWith(
		fetch(event.request)
			.then((response) => {
				if (response.ok && SHELL.includes(url.pathname)) {
					const copy = response.clone()
					caches.open(CACHE).then((cache) => cache.put(event.request, copy))
				}
				return response
			})
			.catch(() => caches.match(event.request).then((hit) => hit || caches.match("/index.html"))),
	)
})
