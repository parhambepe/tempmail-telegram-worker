// KV-backed storage for addresses, messages, settings, gift codes and referrals.

const INV = 1e13 // makes KV keys sort newest-first
const MSG_TTL = 60 * 60 * 24 * 30 // keep mail bodies for 30 days

export function randomId(len) {
	const alphabet = "abcdefghijkmnpqrstuvwxyz23456789"
	const bytes = new Uint8Array(len || 10)
	crypto.getRandomValues(bytes)
	let out = ""
	for (const b of bytes) out += alphabet[b % alphabet.length]
	return out
}

export class Store {
	constructor(kv, domain) {
		this.kv = kv
		this.domain = domain
	}

	// ---------- addresses ----------

	async createAddress(chatId, options) {
		const opts = options || {}
		const ttlSeconds = opts.ttlSeconds || null
		for (let attempt = 0; attempt < 5; attempt++) {
			const localPart = String(opts.local || randomId()).toLowerCase()
			if (!/^[a-z0-9._-]{3,32}$/.test(localPart)) return { error: "invalid" }
			const address = localPart + "@" + this.domain
			if (await this.kv.get("addr:" + address)) {
				if (opts.local) return { error: "taken" }
				continue
			}
			const record = {
				address,
				chatId: String(chatId),
				type: ttlSeconds ? "temp" : "perm",
				createdAt: Date.now(),
				expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
			}
			const putOpts = ttlSeconds ? { expirationTtl: Math.max(60, ttlSeconds) } : {}
			await this.kv.put("addr:" + address, JSON.stringify(record), putOpts)
			await this.kv.put("user:" + chatId + ":addr:" + address, "1", {
				...putOpts,
				metadata: record,
			})
			return { record }
		}
		return { error: "collision" }
	}

	async lookupAddress(address) {
		const raw = await this.kv.get("addr:" + String(address).toLowerCase())
		return raw ? JSON.parse(raw) : null
	}

	async listAddresses(chatId) {
		const listed = await this.kv.list({ prefix: "user:" + chatId + ":addr:" })
		return listed.keys
			.map((k) => k.metadata)
			.filter(Boolean)
			.sort((a, b) => b.createdAt - a.createdAt)
	}

	async deleteAddress(chatId, address) {
		const record = await this.lookupAddress(address)
		if (!record || record.chatId !== String(chatId)) return false
		await this.kv.delete("addr:" + address)
		await this.kv.delete("user:" + chatId + ":addr:" + address)
		return true
	}

	async countPermanent(chatId) {
		const all = await this.listAddresses(chatId)
		return all.filter((a) => a.type === "perm").length
	}

	// ---------- messages ----------

	async saveMessage(chatId, message) {
		const key = "msg:" + chatId + ":" + (INV - Date.now()) + ":" + randomId(4)
		await this.kv.put(key, JSON.stringify(message), {
			expirationTtl: MSG_TTL,
			metadata: {
				from: message.from,
				to: message.to,
				subject: message.subject,
				receivedAt: message.receivedAt,
			},
		})
		return key
	}

	async listMessages(chatId, limit) {
		const listed = await this.kv.list({
			prefix: "msg:" + chatId + ":",
			limit: limit || 10,
		})
		return listed.keys.map((k) => ({ key: k.name, ...(k.metadata || {}) }))
	}

	async getMessage(key) {
		const raw = await this.kv.get(key)
		return raw ? JSON.parse(raw) : null
	}

	// ---------- settings ----------

	async getSettings(chatId) {
		const raw = await this.kv.get("settings:" + chatId)
		return { notify: true, showLinks: true, ...(raw ? JSON.parse(raw) : {}) }
	}

	async setSettings(chatId, patch) {
		const next = { ...(await this.getSettings(chatId)), ...patch }
		await this.kv.put("settings:" + chatId, JSON.stringify(next))
		return next
	}

	// ---------- gift codes + referrals ----------

	async createGiftCode(slots) {
		const code = randomId(8).toUpperCase()
		await this.kv.put("gift:" + code, JSON.stringify({ slots, createdAt: Date.now() }))
		return code
	}

	async redeemGiftCode(chatId, code) {
		const key = "gift:" + String(code).trim().toUpperCase()
		const raw = await this.kv.get(key)
		if (!raw) return { error: "not_found" }
		const gift = JSON.parse(raw)
		await this.kv.delete(key)
		const total = await this.addBonusSlots(chatId, gift.slots)
		return { slots: gift.slots, total }
	}

	async getBonusSlots(chatId) {
		return Number((await this.kv.get("bonus:" + chatId)) || 0)
	}

	async addBonusSlots(chatId, n) {
		const total = (await this.getBonusSlots(chatId)) + n
		await this.kv.put("bonus:" + chatId, String(total))
		return total
	}

	async registerReferral(newChatId, referrerChatId) {
		if (String(newChatId) === String(referrerChatId)) return false
		const key = "ref:" + newChatId
		if (await this.kv.get(key)) return false
		await this.kv.put(key, String(referrerChatId))
		await this.addBonusSlots(referrerChatId, 1)
		return true
	}

	// ---------- short-lived conversation state ----------

	async setState(chatId, state) {
		if (!state) return this.kv.delete("state:" + chatId)
		return this.kv.put("state:" + chatId, JSON.stringify(state), { expirationTtl: 600 })
	}

	async getState(chatId) {
		const raw = await this.kv.get("state:" + chatId)
		return raw ? JSON.parse(raw) : null
	}
}
