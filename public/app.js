// Web client for the TempMail worker. Shares the same accounts/data as the
// Telegram bot: a login code from the bot is exchanged for a session token.

const TOKEN_KEY = "tempmail.token"
const DEMO = new URLSearchParams(location.search).has("demo")

const $ = (id) => document.getElementById(id)
const state = { token: localStorage.getItem(TOKEN_KEY), me: null, timer: null, poll: null }

// ---------- helpers ----------

function toast(text) {
	const el = $("toast")
	el.textContent = text
	el.classList.remove("hidden")
	clearTimeout(toast.t)
	toast.t = setTimeout(() => el.classList.add("hidden"), 2200)
}

async function api(path, options) {
	const opts = options || {}
	const res = await fetch("/api" + path, {
		method: opts.method || "GET",
		headers: {
			"content-type": "application/json",
			...(state.token ? { authorization: "Bearer " + state.token } : {}),
		},
		body: opts.body ? JSON.stringify(opts.body) : undefined,
	})
	if (res.status === 401) {
		signOut(true)
		throw new Error("unauthorized")
	}
	const data = await res.json().catch(() => ({}))
	if (!res.ok) throw Object.assign(new Error(data.error || "request_failed"), { data })
	return data
}

function relativeTime(iso) {
	if (!iso) return ""
	const diff = Date.now() - new Date(iso).getTime()
	const minutes = Math.round(diff / 60000)
	if (minutes < 1) return "همین حالا"
	if (minutes < 60) return minutes + " دقیقه پیش"
	const hours = Math.round(minutes / 60)
	if (hours < 24) return hours + " ساعت پیش"
	return Math.round(hours / 24) + " روز پیش"
}

function ttlText(record) {
	if (!record) return "—"
	if (!record.expiresAt) return "دائمی"
	const ms = record.expiresAt - Date.now()
	if (ms <= 0) return "منقضی شد"
	const h = Math.floor(ms / 3600000)
	const m = Math.floor((ms % 3600000) / 60000)
	const s = Math.floor((ms % 60000) / 1000)
	return h > 0 ? h + " ساعت و " + m + " دقیقه" : m + ":" + String(s).padStart(2, "0")
}

// ---------- views ----------

function showLogin() {
	$("view-login").classList.remove("hidden")
	$("view-app").classList.add("hidden")
	$("logout").classList.add("hidden")
	clearInterval(state.poll)
	clearInterval(state.timer)
}

function showApp() {
	$("view-login").classList.add("hidden")
	$("view-app").classList.remove("hidden")
	$("logout").classList.remove("hidden")
}

function renderAccount() {
	const me = state.me
	if (!me) return
	const active = me.addresses[0]
	$("active-address").textContent = active ? active.address : "آدرسی نساخته‌اید"
	$("active-ttl").textContent = ttlText(active)
	$("quota").textContent =
		"آدرس دائمی: " + me.limits.permanentUsed + " از " + me.limits.permanent + " · دامنه: " + me.domain
	$("account-line").textContent = "حساب تلگرام: " + me.chatId
	$("set-notify").checked = !!me.settings.notify
	$("set-links").checked = !!me.settings.showLinks

	const list = $("address-list")
	list.textContent = ""
	for (const address of me.addresses) {
		const li = document.createElement("li")
		const main = document.createElement("div")
		main.className = "addr-main"
		const code = document.createElement("code")
		code.dir = "ltr"
		code.textContent = address.address
		const meta = document.createElement("span")
		meta.className = "mail-meta"
		meta.textContent = (address.type === "perm" ? "دائمی" : "موقت") + " · " + ttlText(address)
		main.append(code, meta)

		const copy = document.createElement("button")
		copy.className = "ghost small"
		copy.type = "button"
		copy.textContent = "کپی"
		copy.onclick = () => copyText(address.address)

		const del = document.createElement("button")
		del.className = "danger"
		del.type = "button"
		del.textContent = "حذف"
		del.onclick = () => removeAddress(address.address)

		const actions = document.createElement("div")
		actions.className = "row gap"
		actions.append(copy, del)
		li.append(main, actions)
		list.append(li)
	}
}

function renderInbox(messages) {
	const list = $("inbox-list")
	list.textContent = ""
	$("inbox-empty").classList.toggle("hidden", messages.length > 0)
	for (const mail of messages) {
		const li = document.createElement("li")
		const btn = document.createElement("button")
		btn.className = "mail-btn"
		btn.type = "button"
		const subject = document.createElement("span")
		subject.className = "mail-subject"
		subject.textContent = mail.subject || "(بدون موضوع)"
		const meta = document.createElement("span")
		meta.className = "mail-meta"
		meta.textContent = (mail.from || "") + " → " + (mail.to || "")
		btn.append(subject, meta)
		btn.onclick = () => openMail(mail)

		const time = document.createElement("span")
		time.className = "mail-meta"
		time.textContent = relativeTime(mail.receivedAt)
		li.append(btn, time)
		list.append(li)
	}
}

// ---------- actions ----------

async function copyText(text) {
	try {
		await navigator.clipboard.writeText(text)
		toast("کپی شد: " + text)
	} catch (err) {
		toast("کپی نشد، دستی انتخاب کنید")
	}
}

async function loadAll() {
	if (DEMO) return
	state.me = await api("/me")
	renderAccount()
	const { messages } = await api("/messages?limit=20")
	renderInbox(messages)
}

async function createAddress(type) {
	let local = null
	if (type === "perm") {
		local = prompt("نام دلخواه برای آدرس دائمی (a-z، 0-9، نقطه، خط تیره):")
		if (!local) return
	}
	try {
		const { address } = await api("/addresses", { method: "POST", body: { type, local } })
		toast("ساخته شد: " + address.address)
		await loadAll()
	} catch (err) {
		const map = {
			limit_reached: "سقف آدرس دائمی پر شده است",
			taken: "این نام قبلاً گرفته شده",
			invalid: "نام نامعتبر است (۳ تا ۳۲ حرف انگلیسی)",
		}
		toast(map[err.message] || "خطا در ساخت آدرس")
	}
}

async function removeAddress(address) {
	if (!confirm("حذف " + address + "؟")) return
	await api("/addresses/" + encodeURIComponent(address), { method: "DELETE" })
	toast("حذف شد")
	await loadAll()
}

async function openMail(mail) {
	$("sheet-subject").textContent = mail.subject || "(بدون موضوع)"
	$("sheet-meta").textContent = (mail.from || "") + " → " + (mail.to || "")
	$("sheet-body").textContent = "در حال بارگذاری..."
	$("sheet").classList.remove("hidden")
	if (DEMO) {
		$("sheet-body").textContent = mail.text || ""
		return
	}
	try {
		const { mail: full } = await api("/messages/get?key=" + encodeURIComponent(mail.key))
		$("sheet-body").textContent = full.text || "(بدون متن)"
	} catch (err) {
		$("sheet-body").textContent = "این ایمیل پیدا نشد یا منقضی شده است."
	}
}

function signOut(silent) {
	localStorage.removeItem(TOKEN_KEY)
	state.token = null
	state.me = null
	showLogin()
	if (!silent) toast("خارج شدید")
}

// ---------- wiring ----------

$("login-form").addEventListener("submit", async (event) => {
	event.preventDefault()
	const code = $("code").value.trim()
	$("login-error").classList.add("hidden")
	try {
		const res = await fetch("/api/session", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ code }),
		})
		if (!res.ok) throw new Error("invalid")
		const { token } = await res.json()
		localStorage.setItem(TOKEN_KEY, token)
		state.token = token
		$("code").value = ""
		await start()
	} catch (err) {
		const el = $("login-error")
		el.textContent = "کد نامعتبر یا منقضی شده است. از ربات کد تازه بگیرید."
		el.classList.remove("hidden")
	}
})

$("logout").onclick = () => signOut()
$("copy-active").onclick = () => copyText($("active-address").textContent)
$("new-temp").onclick = () => createAddress("temp")
$("new-perm").onclick = () => createAddress("perm")
$("refresh").onclick = () => loadAll().then(() => toast("به‌روز شد"))
$("sheet-close").onclick = () => $("sheet").classList.add("hidden")
$("sheet").addEventListener("click", (event) => {
	if (event.target === $("sheet")) $("sheet").classList.add("hidden")
})

for (const tab of document.querySelectorAll(".tab")) {
	tab.onclick = () => {
		for (const other of document.querySelectorAll(".tab")) other.classList.remove("active")
		tab.classList.add("active")
		for (const name of ["inbox", "addresses", "settings"]) {
			$("tab-" + name).classList.toggle("hidden", name !== tab.dataset.tab)
		}
	}
}

for (const id of ["set-notify", "set-links"]) {
	$(id).onchange = async () => {
		if (DEMO) return
		const body = { notify: $("set-notify").checked, showLinks: $("set-links").checked }
		const { settings } = await api("/settings", { method: "POST", body })
		state.me.settings = settings
		toast("ذخیره شد")
	}
}

async function start() {
	if (DEMO) return startDemo()
	if (!state.token) return showLogin()
	try {
		await loadAll()
		showApp()
		clearInterval(state.poll)
		clearInterval(state.timer)
		state.poll = setInterval(() => loadAll().catch(() => {}), 20000)
		state.timer = setInterval(() => {
			if (state.me) $("active-ttl").textContent = ttlText(state.me.addresses[0])
		}, 1000)
	} catch (err) {
		showLogin()
	}
}

// Static preview used for design review: /?demo=1
function startDemo() {
	state.me = {
		chatId: "123456789",
		domain: "mail.example.com",
		settings: { notify: true, showLinks: false },
		limits: { permanent: 3, permanentUsed: 1, tempTtlSeconds: 86400 },
		addresses: [
			{ address: "kq7m2xw9@mail.example.com", type: "temp", expiresAt: Date.now() + 5400000, createdAt: Date.now() },
			{ address: "parham@mail.example.com", type: "perm", expiresAt: null, createdAt: Date.now() },
		],
	}
	renderAccount()
	renderInbox([
		{
			key: "demo1",
			subject: "Your verification code is 481920",
			from: "no-reply@github.com",
			to: "kq7m2xw9@mail.example.com",
			receivedAt: new Date(Date.now() - 120000).toISOString(),
			text: "Use code 481920 to finish signing in.",
		},
		{
			key: "demo2",
			subject: "Welcome to Cloudflare",
			from: "noreply@cloudflare.com",
			to: "parham@mail.example.com",
			receivedAt: new Date(Date.now() - 7200000).toISOString(),
			text: "Your account is ready.",
		},
	])
	showApp()
}

if ("serviceWorker" in navigator) {
	navigator.serviceWorker.register("/sw.js").catch(() => {})
}

start()
