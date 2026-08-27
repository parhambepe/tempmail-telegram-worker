// Thin Telegram Bot API client + shared keyboards.

export function esc(value) {
	return String(value === undefined || value === null ? "" : value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
}

export class Telegram {
	constructor(token) {
		this.base = "https://api.telegram.org/bot" + token
	}

	async call(method, payload) {
		const res = await fetch(this.base + "/" + method, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload),
		})
		const data = await res.json().catch(() => ({ ok: false }))
		if (!data.ok) console.error("telegram " + method + " failed:", data.description)
		return data
	}

	sendMessage(chatId, text, extra) {
		return this.call("sendMessage", {
			chat_id: chatId,
			text,
			parse_mode: "HTML",
			link_preview_options: { is_disabled: true },
			...(extra || {}),
		})
	}

	answerCallbackQuery(id, text) {
		return this.call("answerCallbackQuery", {
			callback_query_id: id,
			text: text || "",
		})
	}

	setMyCommands(commands) {
		return this.call("setMyCommands", { commands })
	}

	async sendDocument(chatId, filename, bytes, caption) {
		const form = new FormData()
		form.append("chat_id", String(chatId))
		if (caption) {
			form.append("caption", caption.slice(0, 1000))
			form.append("parse_mode", "HTML")
		}
		form.append("document", new Blob([bytes]), filename || "attachment.bin")
		const res = await fetch(this.base + "/sendDocument", { method: "POST", body: form })
		return res.json().catch(() => ({ ok: false }))
	}
}

// All user-facing strings live here and in bot.js, so translating the UI
// (for example to Persian) only means editing these two files.
export const MAIN_MENU = {
	inline_keyboard: [
		[
			{ text: "\u2795 Temporary Email", callback_data: "new:temp" },
			{ text: "\u267e Permanent Email", callback_data: "new:perm" },
		],
		[
			{ text: "\ud83d\udce5 My Inbox", callback_data: "inbox" },
			{ text: "\ud83d\udcee My Addresses", callback_data: "addresses" },
		],
		[
			{ text: "\ud83c\udf81 Gift Code", callback_data: "gift" },
			{ text: "\ud83d\udd17 Invite Friends", callback_data: "invite" },
		],
		[
			{ text: "\u2699\ufe0f Settings", callback_data: "settings" },
			{ text: "\u2139\ufe0f Help", callback_data: "help" },
		],
	],
}

export const BACK_MENU = {
	inline_keyboard: [[{ text: "\u2b05\ufe0f Back to menu", callback_data: "menu" }]],
}
