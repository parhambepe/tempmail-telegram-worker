// Bridges Telegram accounts and the web UI.
//
// Flow: the bot creates a short-lived 6-digit login code -> the web app posts
// the code to /api/session -> the worker returns a long-lived session token
// that maps back to the same Telegram chatId. Both clients therefore read and
// write exactly the same KV data.

import { randomId } from "./store.js"

const CODE_TTL = 300 // 5 minutes
const SESSION_TTL = 60 * 60 * 24 * 30 // 30 days

function sixDigits() {
	return String(Math.floor(100000 + Math.random() * 900000))
}

export async function createLoginCode(kv, chatId) {
	const code = sixDigits()
	await kv.put("code:" + code, String(chatId), { expirationTtl: CODE_TTL })
	return { code, expiresInSeconds: CODE_TTL }
}

export async function consumeLoginCode(kv, code) {
	const clean = String(code || "").replace(/\D/g, "")
	if (clean.length !== 6) return null
	const chatId = await kv.get("code:" + clean)
	if (!chatId) return null
	await kv.delete("code:" + clean) // single use
	return chatId
}

export async function createSession(kv, chatId) {
	const token = randomId(12) + randomId(12)
	await kv.put("session:" + token, String(chatId), { expirationTtl: SESSION_TTL })
	return { token, expiresInSeconds: SESSION_TTL }
}

export async function getSessionChatId(kv, token) {
	if (!token) return null
	return kv.get("session:" + token)
}

export async function deleteSession(kv, token) {
	if (token) await kv.delete("session:" + token)
}
