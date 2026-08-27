// Entry point: Telegram webhook (fetch), JSON API + static web UI, and
// incoming mail (email handler).

import { Bot } from "./bot.js"
import { Telegram } from "./telegram.js"
import { handleIncomingEmail } from "./email.js"
import { handleApi } from "./api.js"
import { createLoginCode } from "./webAuth.js"

const COMMANDS = [
	{ command: "start", description: "Start / main menu" },
	{ command: "new", description: "Create a temporary email" },
	{ command: "addresses", description: "My addresses" },
	{ command: "inbox", description: "Inbox" },
	{ command: "web", description: "Log in to the web app" },
	{ command: "help", description: "Help" },
]

// Handles /web before the main bot router, so bot.js stays untouched.
async function handleWebCommand(update, env, origin) {
	const message = update.message
	const text = message && typeof message.text === "string" ? message.text.trim() : ""
	if (!/^\/web(@\w+)?$/.test(text)) return false
	const chatId = message.chat.id
	const { code, expiresInSeconds } = await createLoginCode(env.MAILBOX, chatId)
	const webUrl = env.WEB_URL || origin
	const minutes = Math.round(expiresInSeconds / 60)
	const body =
		"🌐 <b>Web login</b>\n\n" +
		"1. Open " +
		webUrl +
		"\n2. Enter this code:\n\n<code>" +
		code +
		"</code>\n\nThe code is valid for " +
		minutes +
		" minutes and can be used once. The web app shows the same addresses and inbox as this chat."
	await new Telegram(env.BOT_TOKEN).call("sendMessage", {
		chat_id: chatId,
		text: body,
		parse_mode: "HTML",
		disable_web_page_preview: true,
	})
	return true
}

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url)

		// 1) Telegram webhook
		if (request.method === "POST" && url.pathname === "/webhook") {
			const secret = request.headers.get("x-telegram-bot-api-secret-token")
			if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
				return new Response("forbidden", { status: 403 })
			}
			const update = await request.json().catch(() => null)
			if (!update) return new Response("bad request", { status: 400 })
			ctx.waitUntil(
				handleWebCommand(update, env, url.origin)
					.then((handled) => (handled ? null : new Bot(env).handleUpdate(update)))
					.catch((err) => console.log("update error", err && err.message)),
			)
			return new Response("ok")
		}

		// 2) JSON API for the web UI
		if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
			return handleApi(request, env, url)
		}

		// 3) One-time setup: registers the webhook with Telegram.
		//    Visit https://<worker-url>/init?token=<SETUP_TOKEN>
		if (url.pathname === "/init") {
			if (!env.SETUP_TOKEN || url.searchParams.get("token") !== env.SETUP_TOKEN) {
				return new Response("forbidden", { status: 403 })
			}
			const tg = new Telegram(env.BOT_TOKEN)
			const webhookUrl = url.origin + "/webhook"
			const result = await tg.call("setWebhook", {
				url: webhookUrl,
				secret_token: env.WEBHOOK_SECRET,
				allowed_updates: ["message", "callback_query"],
				drop_pending_updates: true,
			})
			await tg.setMyCommands(COMMANDS)
			return Response.json({ webhookUrl, result })
		}

		// 4) Static web UI from ./public (Workers Assets binding).
		if (env.ASSETS) {
			const response = await env.ASSETS.fetch(request)
			if (response.status !== 404) return response
			// SPA fallback: serve index.html for unknown non-asset paths.
			if (request.method === "GET" && !url.pathname.includes(".")) {
				return env.ASSETS.fetch(new Request(url.origin + "/index.html", request))
			}
			return response
		}

		return new Response("not found", { status: 404 })
	},

	// Cloudflare Email Routing delivers every incoming message here.
	async email(message, env, ctx) {
		return handleIncomingEmail(message, env)
	},
}
