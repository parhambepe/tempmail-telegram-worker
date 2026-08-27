// Entry point: Telegram webhook (fetch) + incoming mail (email handler).

import { Bot } from "./bot.js"
import { Telegram } from "./telegram.js"
import { handleIncomingEmail } from "./email.js"

const COMMANDS = [
	{ command: "start", description: "شروع / منوی اصلی" },
	{ command: "new", description: "ساخت ایمیل موقت" },
	{ command: "addresses", description: "آدرس های من" },
	{ command: "inbox", description: "صندوق دریافت" },
	{ command: "help", description: "راهنما" },
]

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
			ctx.waitUntil(new Bot(env).handleUpdate(update))
			return new Response("ok")
		}

		// 2) One-time setup: registers the webhook with Telegram.
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

		if (url.pathname === "/") {
			return new Response("tempmail worker is running", {
				headers: { "content-type": "text/plain; charset=utf-8" },
			})
		}
		return new Response("not found", { status: 404 })
	},

	// Cloudflare Email Routing delivers every incoming message here.
	async email(message, env, ctx) {
		return handleIncomingEmail(message, env)
	},
}
