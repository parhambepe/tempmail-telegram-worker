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

export const MAIN_MENU = {
	inline_keyboard: [
		[
			{ text: "➕ ایمیل موقت", callback_data: "new:temp" },
			{ text: "♾ ایمیل دائمی", callback_data: "new:perm" },
		],
		[
			{ text: "📥 صندوق من", callback_data: "inbox" },
			{ text: "📮 آدرس های من", callback_data: "addresses" },
		],
		[
			{ text: "🎁 کد هدیه", callback_data: "gift" },
			{ text: "🔗 دعوت دوستان", callback_data: "invite" },
		],
		[
			{ text: "⚙️ تنظیمات", callback_data: "settings" },
			{ text: "ℹ️ راهنما", callback_data: "help" },
		],
	],
}

export const BACK_MENU = {
	inline_keyboard: [[{ text: "⬅️ بازگشت به منو", callback_data: "menu" }]],
}
