// Incoming mail handler: parse the message, store it, push it to Telegram.

import PostalMime from "postal-mime"
import { Store } from "./store.js"
import { Telegram, esc } from "./telegram.js"

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024 // Telegram bot upload limit

export async function handleIncomingEmail(message, env) {
	const store = new Store(env.MAILBOX, env.MAIL_DOMAIN)
	const tg = new Telegram(env.BOT_TOKEN)
	const to = String(message.to || "").toLowerCase()

	const record = await store.lookupAddress(to)
	if (!record) {
		// Unknown/expired address: reject so the sender gets a bounce.
		message.setReject("This address does not exist")
		return
	}

	const raw = await new Response(message.raw).arrayBuffer()
	const parsed = await PostalMime.parse(raw)
	const chatId = record.chatId
	const settings = await store.getSettings(chatId)

	const mail = {
		from: (parsed.from && parsed.from.address) || String(message.from || ""),
		fromName: (parsed.from && parsed.from.name) || "",
		to,
		subject: parsed.subject || "",
		text: parsed.text || stripHtml(parsed.html || ""),
		receivedAt: Date.now(),
		attachments: (parsed.attachments || []).map((a) => ({
			filename: a.filename,
			mimeType: a.mimeType,
			size: a.content ? a.content.byteLength : 0,
		})),
	}
	await store.saveMessage(chatId, mail)

	if (!settings.notify) return

	let body = mail.text || "(بدون متن)"
	if (!settings.showLinks) body = body.replace(/https?:\/\/\S+/g, "[لینک]")

	const header =
		"📨 <b>ایمیل جدید</b>\n" +
		"به: <code>" +
		esc(to) +
		"</code>\n" +
		"از: " +
		esc(mail.fromName ? mail.fromName + " <" + mail.from + ">" : mail.from) +
		"\n" +
		"موضوع: <b>" +
		esc(mail.subject || "(بدون موضوع)") +
		"</b>\n\n"

	const codes = extractCodes(mail.text)
	const codeLine = codes.length ? "🔑 کد: <code>" + esc(codes[0]) + "</code>\n\n" : ""

	await tg.sendMessage(chatId, header + codeLine + esc(body.slice(0, 3200)), {
		reply_markup: { inline_keyboard: [[{ text: "📥 صندوق", callback_data: "inbox" }]] },
	})

	for (const attachment of parsed.attachments || []) {
		if (!attachment.content) continue
		if (attachment.content.byteLength > MAX_ATTACHMENT_BYTES) continue
		await tg.sendDocument(
			chatId,
			attachment.filename || "attachment.bin",
			attachment.content,
			"📎 پیوست ایمیل",
		)
	}
}

function stripHtml(html) {
	return String(html)
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/p>/gi, "\n\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim()
}

// Pull out a likely OTP / verification code so it is easy to copy.
function extractCodes(text) {
	const matches = String(text || "").match(/\b\d{4,8}\b/g)
	return matches ? matches.slice(0, 1) : []
}
