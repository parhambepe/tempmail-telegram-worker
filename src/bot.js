// Telegram command / menu / callback handling.

import { Store } from "./store.js"
import { Telegram, MAIN_MENU, BACK_MENU, esc } from "./telegram.js"

const WELCOME =
	"\ud83d\udce7 <b>Welcome</b>\n\n" +
	"Create and manage email addresses directly from Telegram.\n" +
	"Anything sent to your addresses is forwarded here instantly."

const HELP =
	"\u2139\ufe0f <b>Help</b>\n\n" +
	"\u2022 <b>Temporary email</b>: random address, auto-deleted after the TTL.\n" +
	"\u2022 <b>Permanent email</b>: pick your own name, stays forever.\n" +
	"\u2022 <b>My inbox</b>: last 30 days of mail.\n" +
	"\u2022 Attachments up to 20MB are delivered as files.\n\n" +
	"Commands: /start /new /addresses /inbox /help"

function remainingText(record) {
	if (!record.expiresAt) return "permanent"
	const ms = record.expiresAt - Date.now()
	if (ms <= 0) return "expired"
	const hours = Math.floor(ms / 3600000)
	const minutes = Math.floor((ms % 3600000) / 60000)
	return hours > 0 ? hours + "h " + minutes + "m" : minutes + "m"
}

export class Bot {
	constructor(env) {
		this.env = env
		this.tg = new Telegram(env.BOT_TOKEN)
		this.store = new Store(env.MAILBOX, env.MAIL_DOMAIN)
		this.tempTtl = Number(env.TEMP_TTL_SECONDS || 86400)
		this.maxPerm = Number(env.MAX_PERM_ADDRESSES || 3)
	}

	async handleUpdate(update) {
		try {
			if (update.callback_query) return await this.onCallback(update.callback_query)
			if (update.message) return await this.onMessage(update.message)
		} catch (err) {
			console.error("handleUpdate error", err && err.stack)
		}
	}

	async onMessage(message) {
		const chatId = message.chat.id
		const text = (message.text || "").trim()
		if (!text) return

		if (text.startsWith("/start")) {
			const payload = text.split(" ")[1]
			if (payload && /^ref_\d+$/.test(payload)) {
				await this.store.registerReferral(chatId, payload.slice(4))
			}
			await this.store.setState(chatId, null)
			return this.tg.sendMessage(chatId, WELCOME, { reply_markup: MAIN_MENU })
		}
		if (text === "/help") return this.tg.sendMessage(chatId, HELP, { reply_markup: BACK_MENU })
		if (text === "/menu") return this.tg.sendMessage(chatId, "Main menu:", { reply_markup: MAIN_MENU })
		if (text === "/new") return this.createTemp(chatId)
		if (text === "/addresses") return this.showAddresses(chatId)
		if (text === "/inbox") return this.showInbox(chatId)

		// Admin only: "/gift 3" creates a redeemable code worth 3 permanent slots.
		if (text.startsWith("/gift") && String(chatId) === String(this.env.ADMIN_ID || "")) {
			const slots = Number(text.split(" ")[1] || 1)
			const code = await this.store.createGiftCode(slots)
			return this.tg.sendMessage(chatId, "Gift code: <code>" + code + "</code> (" + slots + " slots)")
		}

		const state = await this.store.getState(chatId)
		if (state && state.awaiting === "gift") {
			await this.store.setState(chatId, null)
			const result = await this.store.redeemGiftCode(chatId, text)
			if (result.error) {
				return this.tg.sendMessage(chatId, "\u274c Invalid or already used code.", { reply_markup: BACK_MENU })
			}
			return this.tg.sendMessage(
				chatId,
				"\u2705 Redeemed. +" + result.slots + " slots (total bonus: " + result.total + ").",
				{ reply_markup: MAIN_MENU },
			)
		}
		if (state && state.awaiting === "perm") {
			await this.store.setState(chatId, null)
			return this.createPerm(chatId, text.toLowerCase().replace(/@.*$/, ""))
		}

		return this.tg.sendMessage(chatId, "Pick an option:", { reply_markup: MAIN_MENU })
	}

	async onCallback(query) {
		const chatId = query.message.chat.id
		const data = query.data || ""
		await this.tg.answerCallbackQuery(query.id)

		if (data === "menu") return this.tg.sendMessage(chatId, "Main menu:", { reply_markup: MAIN_MENU })
		if (data === "help") return this.tg.sendMessage(chatId, HELP, { reply_markup: BACK_MENU })
		if (data === "new:temp") return this.createTemp(chatId)
		if (data === "new:perm") {
			await this.store.setState(chatId, { awaiting: "perm" })
			return this.tg.sendMessage(
				chatId,
				"Send the name you want (3-32 chars: a-z, 0-9, dot, dash).\nExample: <code>parham</code> gives parham@" +
					esc(this.env.MAIL_DOMAIN),
				{ reply_markup: BACK_MENU },
			)
		}
		if (data === "addresses") return this.showAddresses(chatId)
		if (data.startsWith("del:")) {
			const ok = await this.store.deleteAddress(chatId, data.slice(4))
			await this.tg.sendMessage(chatId, ok ? "\ud83d\uddd1 Address deleted." : "\u274c Not found.")
			return this.showAddresses(chatId)
		}
		if (data === "inbox") return this.showInbox(chatId)
		if (data.startsWith("msg:")) return this.showMessage(chatId, data.slice(4))
		if (data === "gift") {
			await this.store.setState(chatId, { awaiting: "gift" })
			return this.tg.sendMessage(chatId, "\ud83c\udf81 Send your gift code:", { reply_markup: BACK_MENU })
		}
		if (data === "invite") {
			const username = this.env.BOT_USERNAME || "your_bot"
			const bonus = await this.store.getBonusSlots(chatId)
			const link = "https://t.me/" + username + "?start=ref_" + chatId
			return this.tg.sendMessage(
				chatId,
				"\ud83d\udd17 Your invite link:\n<code>" + esc(link) + "</code>\n\n+1 permanent slot per invite.\nCurrent bonus slots: <b>" + bonus + "</b>",
				{ reply_markup: BACK_MENU },
			)
		}
		if (data === "settings") return this.showSettings(chatId)
		if (data === "set:notify") {
			const s = await this.store.getSettings(chatId)
			await this.store.setSettings(chatId, { notify: !s.notify })
			return this.showSettings(chatId)
		}
		if (data === "set:links") {
			const s = await this.store.getSettings(chatId)
			await this.store.setSettings(chatId, { showLinks: !s.showLinks })
			return this.showSettings(chatId)
		}
	}

	async createTemp(chatId) {
		const result = await this.store.createAddress(chatId, { ttlSeconds: this.tempTtl })
		if (result.error) return this.tg.sendMessage(chatId, "\u274c Could not create address, try again.")
		return this.tg.sendMessage(
			chatId,
			"\u2705 <b>Temporary address created</b>\n\n<code>" +
				esc(result.record.address) +
				"</code>\n\n\u23f3 Expires in: " +
				remainingText(result.record),
			{
				reply_markup: {
					inline_keyboard: [
						[{ text: "\ud83d\udd01 New address", callback_data: "new:temp" }],
						[{ text: "\u2b05\ufe0f Menu", callback_data: "menu" }],
					],
				},
			},
		)
	}

	async createPerm(chatId, local) {
		const used = await this.store.countPermanent(chatId)
		const allowed = this.maxPerm + (await this.store.getBonusSlots(chatId))
		if (used >= allowed) {
			return this.tg.sendMessage(
				chatId,
				"\u274c Permanent address limit reached (" + allowed + "). Invite friends or redeem a gift code.",
				{ reply_markup: MAIN_MENU },
			)
		}
		const result = await this.store.createAddress(chatId, { local })
		if (result.error === "taken") {
			return this.tg.sendMessage(chatId, "\u274c That name is taken. Try another one.", { reply_markup: MAIN_MENU })
		}
		if (result.error) {
			return this.tg.sendMessage(chatId, "\u274c Invalid name (3-32 chars: a-z, 0-9, dot, dash).", { reply_markup: MAIN_MENU })
		}
		return this.tg.sendMessage(
			chatId,
			"\u267e <b>Permanent address created</b>\n\n<code>" + esc(result.record.address) + "</code>",
			{ reply_markup: MAIN_MENU },
		)
	}

	async showAddresses(chatId) {
		const list = await this.store.listAddresses(chatId)
		if (!list.length) {
			return this.tg.sendMessage(chatId, "You have no addresses yet.", { reply_markup: MAIN_MENU })
		}
		const lines = list.map(
			(a) => "\u2022 <code>" + esc(a.address) + "</code> \u2014 " + remainingText(a),
		)
		const buttons = list
			.slice(0, 10)
			.map((a) => [{ text: "\ud83d\uddd1 " + a.address, callback_data: "del:" + a.address }])
		buttons.push([{ text: "\u2b05\ufe0f Menu", callback_data: "menu" }])
		return this.tg.sendMessage(chatId, "\ud83d\udcee <b>My addresses</b>\n\n" + lines.join("\n"), {
			reply_markup: { inline_keyboard: buttons },
		})
	}

	async showInbox(chatId) {
		const messages = await this.store.listMessages(chatId, 10)
		if (!messages.length) {
			return this.tg.sendMessage(chatId, "\ud83d\udce5 Inbox is empty.", { reply_markup: MAIN_MENU })
		}
		const buttons = messages.map((m, i) => [
			{
				text: i + 1 + ". " + String(m.subject || "(no subject)").slice(0, 40),
				callback_data: ("msg:" + m.key).slice(0, 64),
			},
		])
		buttons.push([{ text: "\u2b05\ufe0f Menu", callback_data: "menu" }])
		const lines = messages.map(
			(m, i) =>
				i + 1 + ". <b>" + esc(m.subject || "(no subject)") + "</b>\n   from: " + esc(m.from) + "\n   to: " + esc(m.to),
		)
		return this.tg.sendMessage(chatId, "\ud83d\udce5 <b>Latest mail</b>\n\n" + lines.join("\n"), {
			reply_markup: { inline_keyboard: buttons },
		})
	}

	async showMessage(chatId, key) {
		if (!key.startsWith("msg:" + chatId + ":")) {
			return this.tg.sendMessage(chatId, "\u274c Not allowed.")
		}
		const mail = await this.store.getMessage(key)
		if (!mail) return this.tg.sendMessage(chatId, "\u274c Message expired or deleted.", { reply_markup: MAIN_MENU })
		const body =
			"\ud83d\udce8 <b>" + esc(mail.subject || "(no subject)") + "</b>\n" +
			"From: " + esc(mail.from) + "\n" +
			"To: <code>" + esc(mail.to) + "</code>\n" +
			"Date: " + esc(mail.receivedAt) + "\n\n" +
			esc((mail.text || "").slice(0, 3500))
		return this.tg.sendMessage(chatId, body, { reply_markup: BACK_MENU })
	}

	async showSettings(chatId) {
		const s = await this.store.getSettings(chatId)
		return this.tg.sendMessage(chatId, "\u2699\ufe0f <b>Settings</b>", {
			reply_markup: {
				inline_keyboard: [
					[{ text: "Notifications: " + (s.notify ? "on" : "off"), callback_data: "set:notify" }],
					[{ text: "Show links: " + (s.showLinks ? "on" : "off"), callback_data: "set:links" }],
					[{ text: "\u2b05\ufe0f Menu", callback_data: "menu" }],
				],
			},
		})
	}
}
