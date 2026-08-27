// Incoming mail handler for Cloudflare Email Routing.

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
		// Unknown or expired address: reject so the sender gets a bounce.
		message.setReject("Address not found")
		return
	}

	const raw = await new Response(message.raw).arrayBuffer()
	const parsed = await PostalMime.parse(raw)

	const mail = {
		from: (parsed.from && parsed.from.address) || message.from,
		to,
		subject: parsed.subject || "(no subject)",
		text: parsed.text || stripHtml(parsed.html || ""),
		receivedAt: new Date().toISOString(),
		attachments: (parsed.attachments || []).map((a) => a.filename || "file"),
	}
	await store.saveMessage(record.chatId, mail)

	const settings = await store.getSettings(record.chatId)
	if (!settings.notify) return

	const header =
		"\ud83d\udce8 <b>New mail</b>\n" +
		"From: " + esc(mail.from) + "\n" +
		"To: <code>" + esc(mail.to) + "</code>\n" +
		"Subject: <b>" + esc(mail.subject) + "</b>\n\n"

	const body = esc(mail.text.slice(0, 3500)) || "(empty body)"
	await tg.sendMessage(record.chatId, header + body)

	for (const attachment of parsed.attachments || []) {
		const bytes = attachment.content
		const size = bytes && (bytes.byteLength || bytes.length || 0)
		if (!size || size > MAX_ATTACHMENT_BYTES) continue
		await tg.sendDocument(
			record.chatId,
			attachment.filename || "attachment.bin",
			bytes,
			"\ud83d\udcce " + esc(attachment.filename || "attachment"),
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
		.replace(/\n{3,}/g, "\n\n")
		.trim()
}
