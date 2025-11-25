const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const express = require('express');
const https = require('https'); // Used for Self-Ping

// --- CONFIGURATION ---
const TELEGRAM_TOKEN = "8567471950:AAEOVaFupM-Z0iepul7Ktu9M_UKVLyNi_wY";
const MONGO_URI = "mongodb+srv://AADLLOCAUX:GzYQskvvwxyMPVEi@cluster0.xr2zdvk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

// 🔴 YOUR RENDER URL (From your logs)
// This is the URL the bot will visit to stay awake
const RENDER_EXTERNAL_URL = "https://aadl-bot-tjym.onrender.com"; 

// --- FAKE SERVER FOR RENDER ---
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🤖 Bot is running and awake!');
});

app.listen(port, () => {
    console.log(`🌐 Fake server listening on port ${port}`);
});

// --- SELF-PING MECHANISM (Every 2 Minutes) ---
// This prevents Render Free Tier from sleeping
setInterval(() => {
    https.get(RENDER_EXTERNAL_URL, (res) => {
        console.log(`🔄 Keep-Alive Ping Sent. Status: ${res.statusCode}`);
    }).on('error', (e) => {
        console.error(`❌ Keep-Alive Error: ${e.message}`);
    });
}, 2 * 60 * 1000); // 2 minutes in milliseconds

// --- DATABASE SETUP ---
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Bot Connected to Database"))
    .catch(err => console.log(err));

const PropertySchema = new mongoose.Schema({
    id: String,
    wilaya: String,
    site: String,
    price: String,
    surface: String,
    type: String,
    link: String,
    map_link: String,
    status: String,
});
const Property = mongoose.model('Property', PropertySchema);

// --- BOT SETUP ---
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

function normalizeWilaya(rawName) {
    if (!rawName) return "Unknown";
    return rawName.replace(/^\d+\s*-\s*/, '').trim();
}

// --- MENU 1: WILAYAS ---
async function sendWilayaMenu(chatId) {
    const items = await Property.find({ status: 'active' }).select('wilaya');
    const uniqueWilayas = [...new Set(items.map(i => normalizeWilaya(i.wilaya)))].sort();

    if (uniqueWilayas.length === 0) {
        bot.sendMessage(chatId, "⚠️ لا توجد بيانات متوفرة حاليا.\nDatabase is empty.");
        return;
    }

    const keyboard = [];
    for (let i = 0; i < uniqueWilayas.length; i += 2) {
        const row = [{ text: uniqueWilayas[i], callback_data: `WIL:${uniqueWilayas[i]}` }];
        if (uniqueWilayas[i+1]) row.push({ text: uniqueWilayas[i+1], callback_data: `WIL:${uniqueWilayas[i+1]}` });
        keyboard.push(row);
    }
    
    bot.sendMessage(chatId, "🇩🇿 <b>مرحباً! اختر الولاية:</b>\nSelect a Wilaya:", { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
}

// --- MENU 2: PROGRAMS ---
const SHORT_LABELS = {
    "Medical": "🩺 Medical", "LGG_Simple": "🏠 Simple", "LGG_Terme": "📅 Terme", "Adjudication": "📢 Enchères"
};

async function sendProgramMenu(chatId, wilaya) {
    const programs = [
        { id: "Medical", text: SHORT_LABELS["Medical"] },
        { id: "LGG_Simple", text: SHORT_LABELS["LGG_Simple"] },
        { id: "LGG_Terme", text: SHORT_LABELS["LGG_Terme"] },
        { id: "Adjudication", text: SHORT_LABELS["Adjudication"] }
    ];

    const keyboard = programs.map(p => [{ text: p.text, callback_data: `PROG:${wilaya}:${p.id}` }]);
    keyboard.push([{ text: "🔙 الرجوع", callback_data: "MAIN_MENU" }]);

    bot.sendMessage(chatId, `📂 <b>ولاية: ${wilaya}</b>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
}

// --- MENU 3: LISTINGS ---
async function sendLocalesList(chatId, selectedWilaya, type) {
    const allItems = await Property.find({ status: 'active', type: type });
    const filteredItems = allItems.filter(item => normalizeWilaya(item.wilaya) === selectedWilaya);

    if (filteredItems.length === 0) {
        bot.sendMessage(chatId, `🚫 لا توجد محلات في ${selectedWilaya}.`, {
            reply_markup: { inline_keyboard: [[{ text: "🔙 الرجوع", callback_data: `WIL:${selectedWilaya}` }]] }
        });
        return;
    }

    let message = `📋 <b>النتائج (${filteredItems.length}):</b>\n\n`;
    filteredItems.slice(0, 10).forEach((item, index) => {
        message += `${index + 1}. <b>${item.site}</b>\n💰 ${item.price} DA\n🔗 <a href="${item.link}">رابط التسجيل</a>\n\n`;
    });
    if (filteredItems.length > 10) message += `<i>... و ${filteredItems.length - 10} آخرين.</i>`;

    bot.sendMessage(chatId, message, {
        parse_mode: 'HTML', disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[{ text: "🔙 الرجوع", callback_data: `WIL:${selectedWilaya}` }]] }
    });
}

// --- HANDLERS ---
bot.onText(/\/start/, (msg) => sendWilayaMenu(msg.chat.id));

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    try {
        if (data === 'MAIN_MENU') await sendWilayaMenu(chatId);
        else if (data.startsWith('WIL:')) await sendProgramMenu(chatId, data.split('WIL:')[1]);
        else if (data.startsWith('PROG:')) {
            const parts = data.split(':');
            await sendLocalesList(chatId, parts[1], parts[2]);
        }
        await bot.answerCallbackQuery(query.id);
    } catch (error) { console.error(error); }
});

console.log("🤖 Interactive Bot is ONLINE on Render.");