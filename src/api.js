// JSON API consumed by the web UI (public/app.js).
// Every route resolves the caller's Telegram chatId from a session token, so
// the web app and the bot always operate on the same data.

import {
	createAddress,
	listAddresses,
	deleteAddress,
	countPermanent,
	listMessages,
	getMessage,
	getSettings,
	setSettings,
	getBonusSlots,
} from "./store.js"
import { consumeLoginCode, createSession, getSessionChatId, deleteSession } from "./webAuth.js"

function json(data, status) {
	return new Response(JSON.stringify(data), {
		status: status || 200,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
	})
}

function bearer(request) {
	const header = request.headers.get("authorization") || ""
	return header.startsWith("Bearer ") ? header.slice(7).trim() : null
}

export async function handleApi(request, env, url) {
	const kv = env.MAILBOX
	const path = url.pathname.replace(/^\/api/, "") || "/"
	const method = request.method.toUpperCase()

	// --- public: exchange a bot login code for a session token ---
	if (path === "/session" && method === "POST") {
		const body = await request.json().catch(() => ({}))
		const chatId = await consumeLoginCode(kv, body.code)
		if (!chatId) return json({ error: "invalid_code" }, 401)
		const session = await createSession(kv, chatId)
		return json({ token: session.token, expiresInSeconds: session.expiresInSeconds })
	}

	// --- everything below requires a session ---
	const token = bearer(request)
	const chatId = await getSessionChatId(kv, token)
	if (!chatId) return json({ error: "unauthorized" }, 401)

	if (path === "/logout" && method === "POST") {
		await deleteSession(kv, token)
		return json({ ok: true })
	}

	if (path === "/me" && method === "GET") {
		const [addresses, settings, bonus] = await Promise.all([
			listAddresses(kv, chatId),
			getSettings(kv, chatId),
			getBonusSlots(kv, chatId),
		])
		const permanentUsed = addresses.filter((a) => a.type === "perm").length
		return json({
			chatId,
			domain: env.MAIL_DOMAIN,
			addresses,
			settings,
			limits: {
				permanent: Number(env.MAX_PERM_ADDRESSES || 3) + Number(bonus || 0),
				permanentUsed,
				tempTtlSeconds: Number(env.TEMP_TTL_SECONDS || 86400),
			},
		})
	}

	if (path === "/addresses" && method === "POST") {
		const body = await request.json().catch(() => ({}))
		const type = body.type === "perm" ? "perm" : "temp"
		if (type === "perm") {
			const [used, bonus] = await Promise.all([countPermanent(kv, chatId), getBonusSlots(kv, chatId)])
			const max = Number(env.MAX_PERM_ADDRESSES || 3) + Number(bonus || 0)
			if (used >= max) return json({ error: "limit_reached" }, 403)
		}
		try {
			const address = await createAddress(env, chatId, type, body.local || null)
			return json({ address })
		} catch (err) {
			const code = err && err.message === "taken" ? "taken" : "invalid"
			return json({ error: code }, 400)
		}
	}

	if (path.startsWith("/addresses/") && method === "DELETE") {
		const address = decodeURIComponent(path.slice("/addresses/".length))
		await deleteAddress(kv, chatId, address)
		return json({ ok: true })
	}

	if (path === "/messages" && method === "GET") {
		const limit = Math.min(Number(url.searchParams.get("limit") || 20), 50)
		const messages = await listMessages(kv, chatId, limit)
		return json({ messages })
	}

	if (path === "/messages/get" && method === "GET") {
		const key = url.searchParams.get("key") || ""
		// Never let a session read another account's messages.
		if (!key.startsWith("msg:" + chatId + ":")) return json({ error: "not_found" }, 404)
		const mail = await getMessage(kv, key)
		if (!mail) return json({ error: "not_found" }, 404)
		return json({ mail })
	}

	if (path === "/settings" && method === "POST") {
		const body = await request.json().catch(() => ({}))
		const current = await getSettings(kv, chatId)
		const settings = {
			...current,
			...(typeof body.notify === "boolean" ? { notify: body.notify } : {}),
			...(typeof body.showLinks === "boolean" ? { showLinks: body.showLinks } : {}),
		}
		await setSettings(kv, chatId, settings)
		return json({ settings })
	}

	return json({ error: "not_found" }, 404)
}
