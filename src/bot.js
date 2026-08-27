// Telegram command / menu / callback handling.

import { Store } from "./store.js"
import { Telegram, MAIN_MENU, BACK_MENU, esc } from "./telegram.js"

const WELCOME =
	"📧 <b>خوش آمدید</b>\n\n" +
	"ساخت و مدیریت ایمیل، مستقیم از تلگرام.\n" +
	"هر ایمیلی که به آدرس های شما برسد، لحظه ای همینجا ارسال می شود."

const HELP =
	"ℹ️ <b>راهنما</b>\n\n" +
	"• <b>ایمیل موقت</b>: آدرس تصادفی که پس از مدت مشخص خودکار پاک می شود.\n" +
	"• <b>ایمیل دائمی</b>: آدرس دلخواه که باقی می ماند.\n" +
	"• <b>صندوق من</b>: ۳۰ روز آخر ایمیل ها.\n" +
	"• پیوست ها تا ۲۰ مگابایت به صورت فایل ارسال می شوند.\n\n" +
	"دستورها: /start /new /addresses /inbox /help"

function remainingText(record) {
	if (!record.expiresAt) return "دائمی"
	const ms = record.expiresAt - Date.now()
	if (ms <= 0) return "منقضی شده"
	const hours = Math.floor(ms / 3600000)
	const minutes = Math.floor((ms % 3600000) / 60000)
	return hours > 0 ? hours + " ساعت و " + minutes + " دقیقه" : minutes + " دقیقه"
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

	// ---------------- text messages ----------------

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
		if (text === "/menu") return this.tg.sendMessage(chatId, "منوی اصلی:", { reply_markup: MAIN_MENU })
		if (text === "/new") return this.createTemp(chatId)
		if (text === "/addresses") return this.showAddresses(chatId)
		if (text === "/inbox") return this.showInbox(chatId)

		// admin only: /gift 3  -> creates a redeemable code worth 3 permanent slots
		if (text.startsWith("/gift") && String(chatId) === String(this.env.ADMIN_ID || "")) {
			const slots = Number(text.split(" ")[1] || 1)
			const code = await this.store.createGiftCode(slots)
			return this.tg.sendMessage(
				chatId,
				"🎁 کد ساخته شد: <code>" + code + "</code>\nاعتبار: " + slots + " آدرس دائمی",
			)
		}

		const state = await this.store.getState(chatId)
		if (state && state.awaiting === "gift") {
			await this.store.setState(chatId, null)
			const result = await this.store.redeemGiftCode(chatId, text)
			if (result.error) {
				return this.tg.sendMessage(chatId, "❌ کد معتبر نیست یا قبلا استفاده شده.", {
					reply_markup: BACK_MENU,
				})
			}
			return this.tg.sendMessage(
				chatId,
				"✅ کد اعمال شد. " + result.slots + " اسلات اضافه شد (مجموع: " + result.total + ").",
				{ reply_markup: MAIN_MENU },
			)
		}
		if (state && state.awaiting === "perm") {
			await this.store.setState(chatId, null)
			return this.createPerm(chatId, text.toLowerCase().replace(/@.*$/, ""))
		}

		return this.tg.sendMessage(chatId, "یکی از گزینه ها را انتخاب کنید:", {
			reply_markup: MAIN_MENU,
		})
	}

	// ---------------- inline buttons ----------------

	async onCallback(query) {
		const chatId = query.message.chat.id
		const data = query.data || ""
		await this.tg.answerCallbackQuery(query.id)

		if (data === "menu") return this.tg.sendMessage(chatId, "منوی اصلی:", { reply_markup: MAIN_MENU })
		if (data === "help") return this.tg.sendMessage(chatId, HELP, { reply_markup: BACK_MENU })
		if (data === "new:temp") return this.createTemp(chatId)
		if (data === "new:perm") {
			await this.store.setState(chatId, { awaiting: "perm" })
			return this.tg.sendMessage(
				chatId,
				"نام دلخواه را بفرستید (۳ تا ۳۲ حرف انگلیسی، عدد، نقطه یا خط تیره).\nمثال: <code>parham</code> ← parham@" +
					esc(this.env.MAIL_DOMAIN),
				{ reply_markup: BACK_MENU },
			)
		}
		if (data === "addresses") return this.showAddresses(chatId)
		if (data.startsWith("del:")) {
			const ok = await this.store.deleteAddress(chatId, data.slice(4))
			await this.tg.sendMessage(chatId, ok ? "🗑 آدرس حذف شد." : "❌ یافت نشد.")
			return this.showAddresses(chatId)
		}
		if (data === "inbox") return this.showInbox(chatId)
		if (data.startsWith("msg:")) return this.showMessage(chatId, data.slice(4))
		if (data === "gift") {
			await this.store.setState(chatId, { awaiting: "gift" })
			return this.tg.sendMessage(chatId, "🎁 کد هدیه را ارسال کنید:", { reply_markup: BACK_MENU })
		}
		if (data === "invite") {
			const username = this.env.BOT_USERNAME || "your_bot"
			const bonus = await this.store.getBonusSlots(chatId)
			const link = "https://t.me/" + username + "?start=ref_" + chatId
			return this.tg.sendMessage(
				chatId,
				"🔗 لینک دعوت شما:\n<code>" +
					esc(link) +
					"</code>\n\nبرای هر دعوت موفق ۱ آدرس دائمی اضافه می شود.\nاسلات هدیه فعلی: <b>" +
					bonus +
					"</b>",
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

	// ---------------- features ----------------

	async createTemp(chatId) {
		const { record, error } = await this.store.createAddress(chatId, {
			ttlSeconds: this.tempTtl,
		})
		if (error) return this.tg.sendMessage(chatId, "❌ خطا در ساخت آدرس، دوباره تلاش کنید.")
		return this.tg.sendMessage(
			chatId,
			"✅ <b>ایمیل موقت ساخته شد</b>\n\n<code>" +
				esc(record.address) +
				"</code>\n\n⏳ اعتبار: " +
				remainingText(record),
			{
				reply_markup: {
					inline_keyboard: [
						[{ text: "🔁 آدرس جدید", callback_data: "new:temp" }],
						[{ text: "⬅️ منو", callback_data: "menu" }],
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
				"❌ سقف آدرس دائمی شما (" + allowed + ") پر شده. با دعوت دوستان یا کد هدیه افزایش دهید.",
				{ reply_markup: MAIN_MENU },
			)
		}
		const { record, error } = await this.store.createAddress(chatId, { local })
		if (error === "taken") {
			return this.tg.sendMessage(chatId, "❌ این نام قبلا گرفته شده. نام دیگری امتحان کنید.", {
				reply_markup: MAIN_MENU,
			})
		}
		if (error) {
			return this.tg.sendMessage(chatId, "❌ نام نامعتبر است (۳ تا ۳۲ حرف انگلیسی/عدد).", {
				reply_markup: MAIN_MENU,
			})
		}
		return this.tg.sendMessage(
			chatId,
			"♾ <b>ایمیل دائمی ساخته شد</b>\n\n<code>" + esc(record.address) + "</code>",
			{ reply_markup: MAIN_MENU },
		)
	}

	async showAddresses(chatId) {
		const list = await this.store.listAddresses(chatId)
		if (!list.length) {
			return this.tg.sendMessage(chatId, "هنوز آدرسی نساخته اید.", { reply_markup: MAIN_MENU })
		}
		const lines = list.map(
			(a) =>
				(a.type === "perm" ? "♾" : "⏳") +
				" <code>" +
				esc(a.address) +
				"</code> — " +
				remainingText(a),
		)
		const buttons = list
			.slice(0, 8)
			.map((a) => [{ text: "🗑 " + a.address, callback_data: "del:" + a.address }])
		buttons.push([{ text: "⬅️ منو", callback_data: "menu" }])
		return this.tg.sendMessage(chatId, "📮 <b>آدرس های من</b>\n\n" + lines.join("\n"), {
			reply_markup: { inline_keyboard: buttons },
		})
	}

	async showInbox(chatId) {
		const messages = await this.store.listMessages(chatId, 10)
		if (!messages.length) {
			return this.tg.sendMessage(chatId, "📥 صندوق خالی است.", { reply_markup: MAIN_MENU })
		}
		const buttons = messages.map((m, i) => [
			{
				text: i + 1 + ". " + String(m.subject || "(بدون موضوع)").slice(0, 40),
				callback_data: ("msg:" + m.key).slice(0, 64),
			},
		])
		buttons.push([{ text: "⬅️ منو", callback_data: "menu" }])
		const lines = messages.map(
			(m, i) =>
				i + 1 + ". <b>" + esc(m.subject || "(بدون موضوع)") + "</b>\n    از " + esc(m.from) + " → " + esc(m.to),
		)
		return this.tg.sendMessage(chatId, "📥 <b>آخرین ایمیل ها</b>\n\n" + lines.join("\n"), {
			reply_markup: { inline_keyboard: buttons },
		})
	}

	async showMessage(chatId, key) {
		if (!key.startsWith("msg:" + chatId + ":")) {
			return this.tg.sendMessage(chatId, "❌ دسترسی مجاز نیست.")
		}
		const mail = await this.store.getMessage(key)
		if (!mail) return this.tg.sendMessage(chatId, "❌ این ایمیل منقضی یا حذف شده است.")
		const body = String(mail.text || "").slice(0, 3500)
		return this.tg.sendMessage(
			chatId,
			"✉️ <b>" +
				esc(mail.subject || "(بدون موضوع)") +
				"</b>\nاز: " +
				esc(mail.from) +
				"\nبه: " +
				esc(mail.to) +
				"\n\n" +
				esc(body),
			{ reply_markup: { inline_keyboard: [[{ text: "⬅️ صندوق", callback_data: "inbox" }]] } },
		)
	}

	async showSettings(chatId) {
		const s = await this.store.getSettings(chatId)
		return this.tg.sendMessage(chatId, "⚙️ <b>تنظیمات</b>", {
			reply_markup: {
				inline_keyboard: [
					[
						{
							text: (s.notify ? "🔔" : "🔕") + " اعلان ایمیل جدید",
							callback_data: "set:notify",
						},
					],
					[
						{
							text: (s.showLinks ? "✅" : "❌") + " نمایش لینک های داخل ایمیل",
							callback_data: "set:links",
						},
					],
					[{ text: "⬅️ منو", callback_data: "menu" }],
				],
			},
		})
	}
}
