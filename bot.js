const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const express = require('express');
const https = require('https'); 

// --- CONFIGURATION ---
const TELEGRAM_TOKEN = "8567471950:AAEOVaFupM-Z0iepul7Ktu9M_UKVLyNi_wY";
const MONGO_URI = "mongodb+srv://AADLLOCAUX:GzYQskvvwxyMPVEi@cluster0.xr2zdvk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const RENDER_EXTERNAL_URL = "https://aadl-bot-tjym.onrender.com"; 

// --- CONSTANTS ---
const MY_USERNAME = "gmiyad";
const SERVICE_MSG = encodeURIComponent("تصميم وتطوير المواقع ( متاجر الكترونية ، مواقع شخصية ، مدونات ، ووردبريس )");
const SERVICE_LINK = `https://t.me/${MY_USERNAME}?text=${SERVICE_MSG}`;
const SERVICE_BUTTON_ROW = [{ text: "🛍️ انشئ متجرك الإلكتروني", url: SERVICE_LINK }];

// --- EXPRESS SERVER ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('🤖 Bot is running and awake!'));
app.listen(port, () => console.log(`🌐 Fake server listening on port ${port}`));

// --- SELF-PING ---
setInterval(() => {
    https.get(RENDER_EXTERNAL_URL, (res) => console.log(`🔄 Ping: ${res.statusCode}`)).on('error', () => {});
}, 2 * 60 * 1000); 

// --- DATABASE SETUP ---
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Bot Connected to Database"))
    .catch(err => console.log(err));

// 1. Property Schema
const PropertySchema = new mongoose.Schema({
    id: String,
    wilaya: String,
    site: String,
    price: String,
    surface: String,
    type: String,
    link: String,
    map_link: String,
    telegram_message_id: Number,
    status: String,
});
const Property = mongoose.model('Property', PropertySchema);

// 2. NEW: User Subscription Schema
const UserSchema = new mongoose.Schema({
    chatId: { type: Number, unique: true },
    firstName: String,
    username: String,
    subscriptions: [String] // Array of Wilaya names
});
const User = mongoose.model('User', UserSchema);

// --- BOT SETUP ---
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

function normalizeWilaya(rawName) {
    if (!rawName) return "Unknown";
    return rawName.replace(/^\d+\s*-\s*/, '').trim();
}

// --- MENU 1: WILAYAS (Main Menu) ---
async function sendWilayaMenu(chatId) {
    const items = await Property.find({ status: 'active' }).select('wilaya');
    const uniqueWilayas = [...new Set(items.map(i => normalizeWilaya(i.wilaya)))].sort();

    const keyboard = [];
    for (let i = 0; i < uniqueWilayas.length; i += 2) {
        const row = [{ text: uniqueWilayas[i], callback_data: `WIL:${uniqueWilayas[i]}` }];
        if (uniqueWilayas[i+1]) row.push({ text: uniqueWilayas[i+1], callback_data: `WIL:${uniqueWilayas[i+1]}` });
        keyboard.push(row);
    }

    // --- NEW: Notification Button ---
    keyboard.push([{ text: "🔔 تفعيل تنبيهات الولايات (Notifications)", callback_data: "NOTIF_MENU" }]);
    keyboard.push(SERVICE_BUTTON_ROW);

    bot.sendMessage(chatId, "🇩🇿 <b>مرحباً! اختر الولاية:</b>\nSelect a Wilaya:", { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
}

// --- NEW MENU: SUBSCRIPTION MANAGEMENT ---
async function sendSubscriptionMenu(chatId) {
    // 1. Get all available Wilayas
    const items = await Property.find({ status: 'active' }).select('wilaya');
    const allWilayas = [...new Set(items.map(i => normalizeWilaya(i.wilaya)))].sort();

    // 2. Get User's Current Subscriptions
    let user = await User.findOne({ chatId: chatId });
    if (!user) {
        user = await User.create({ chatId: chatId, subscriptions: [] });
    }

    // 3. Build Toggle Buttons
    const keyboard = [];
    for (let i = 0; i < allWilayas.length; i += 2) {
        const w1 = allWilayas[i];
        const isSub1 = user.subscriptions.includes(w1);
        const btn1 = { 
            text: isSub1 ? `✅ ${w1}` : `🔕 ${w1}`, 
            callback_data: `TOGGLE:${w1}` 
        };

        const row = [btn1];

        if (allWilayas[i+1]) {
            const w2 = allWilayas[i+1];
            const isSub2 = user.subscriptions.includes(w2);
            const btn2 = { 
                text: isSub2 ? `✅ ${w2}` : `🔕 ${w2}`, 
                callback_data: `TOGGLE:${w2}` 
            };
            row.push(btn2);
        }
        keyboard.push(row);
    }

    keyboard.push([{ text: "🔙 الرجوع للقائمة الرئيسية", callback_data: "MAIN_MENU" }]);

    bot.sendMessage(chatId, "🔔 <b>إدارة التنبيهات:</b>\nاضغط على الولاية لتفعيل أو إيقاف الإشعار عند توفر محلات جديدة.\n\nClick to subscribe/unsubscribe:", { 
        parse_mode: 'HTML', 
        reply_markup: { inline_keyboard: keyboard } 
    });
}

// --- MENU 2: PROGRAMS ---
const SHORT_LABELS = { "Medical": "🩺 Medical", "LGG_Simple": "🏠 Simple", "LGG_Terme": "📅 Terme", "Adjudication": "📢 Enchères" };

async function sendProgramMenu(chatId, wilaya) {
    const programs = [
        { id: "Medical", text: SHORT_LABELS["Medical"] },
        { id: "LGG_Simple", text: SHORT_LABELS["LGG_Simple"] },
        { id: "LGG_Terme", text: SHORT_LABELS["LGG_Terme"] },
        { id: "Adjudication", text: SHORT_LABELS["Adjudication"] }
    ];
    const keyboard = programs.map(p => [{ text: p.text, callback_data: `PROG:${wilaya}:${p.id}` }]);
    keyboard.push([{ text: "🔙 الرجوع", callback_data: "MAIN_MENU" }]);
    keyboard.push(SERVICE_BUTTON_ROW);

    bot.sendMessage(chatId, `📂 <b>ولاية: ${wilaya}</b>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
}

// --- MENU 3: LISTINGS ---
async function sendLocalesList(chatId, selectedWilaya, type) {
    const allItems = await Property.find({ status: 'active', type: type });
    const filteredItems = allItems.filter(item => normalizeWilaya(item.wilaya) === selectedWilaya);

    if (filteredItems.length === 0) {
        bot.sendMessage(chatId, `🚫 لا توجد محلات في ${selectedWilaya}.`, {
            reply_markup: { inline_keyboard: [[{ text: "🔙 الرجوع", callback_data: `WIL:${selectedWilaya}` }], SERVICE_BUTTON_ROW] }
        });
        return;
    }

    const BATCH_SIZE = 15;
    bot.sendMessage(chatId, `🚀 <b>جاري تحميل ${filteredItems.length} نتيجة...</b>`, { parse_mode: 'HTML' });

    for (let i = 0; i < filteredItems.length; i += BATCH_SIZE) {
        const batch = filteredItems.slice(i, i + BATCH_SIZE);
        let message = "";
        if (i === 0) message += `📋 <b>قائمة النتائج (${selectedWilaya}):</b>\n\n`;

        batch.forEach((item, index) => {
            const channelLink = item.telegram_message_id ? `https://t.me/AADLLOCAUX/${item.telegram_message_id}` : `https://t.me/AADLLOCAUX`;
            message += `${i + index + 1}. <b>${item.site}</b>\n💰 ${item.price} DA\n`;
            if (item.map_link) message += `📍 <a href="${item.map_link}">موقع جوجل (Inspection)</a>\n`;
            if (item.link) message += `🔗 <a href="${item.link}">رابط التسجيل</a>\n`;
            message += `📢 <a href="${channelLink}">عرض الإعلان في القناة</a>\n----------------------------\n\n`;
        });

        const isLastBatch = (i + BATCH_SIZE) >= filteredItems.length;
        const options = { parse_mode: 'HTML', disable_web_page_preview: true };
        if (isLastBatch) {
            options.reply_markup = { inline_keyboard: [[{ text: "🔙 الرجوع", callback_data: `WIL:${selectedWilaya}` }], SERVICE_BUTTON_ROW] };
        }
        await bot.sendMessage(chatId, message, options);
    }
}

// --- HANDLERS ---
bot.onText(/\/start/, async (msg) => {
    // Save user to DB on start if not exists
    const chatId = msg.chat.id;
    let user = await User.findOne({ chatId: chatId });
    if (!user) {
        await User.create({ 
            chatId: chatId, 
            firstName: msg.from.first_name, 
            username: msg.from.username 
        });
    }
    await sendWilayaMenu(chatId);
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    try {
        if (data === 'MAIN_MENU') {
            await sendWilayaMenu(chatId);
        } else if (data === 'NOTIF_MENU') {
            // Open Subscription Menu
            await sendSubscriptionMenu(chatId);
        } else if (data.startsWith('TOGGLE:')) {
            // Handle Subscription Toggle
            const wilayaToToggle = data.split('TOGGLE:')[1];
            let user = await User.findOne({ chatId: chatId });
            
            if (user) {
                if (user.subscriptions.includes(wilayaToToggle)) {
                    // Unsubscribe
                    user.subscriptions = user.subscriptions.filter(w => w !== wilayaToToggle);
                    await bot.answerCallbackQuery(query.id, { text: `❌ Unsubscribed from ${wilayaToToggle}` });
                } else {
                    // Subscribe
                    user.subscriptions.push(wilayaToToggle);
                    await bot.answerCallbackQuery(query.id, { text: `✅ Subscribed to ${wilayaToToggle}` });
                }
                await user.save();
                // Refresh the menu to show new ✅/🔕 status
                await sendSubscriptionMenu(chatId);
            }
        } else if (data.startsWith('WIL:')) {
            await sendProgramMenu(chatId, data.split('WIL:')[1]);
        } else if (data.startsWith('PROG:')) {
            const parts = data.split(':');
            await sendLocalesList(chatId, parts[1], parts[2]);
        }
    } catch (error) { console.error(error); }
});

console.log("🤖 Interactive Bot is ONLINE on Render.");