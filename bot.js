const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const express = require('express');
const https = require('https'); 

// --- CONFIGURATION ---
const TELEGRAM_TOKEN = "8567471950:AAEOVaFupM-Z0iepul7Ktu9M_UKVLyNi_wY";
const MONGO_URI = "mongodb+srv://AADLLOCAUX:GzYQskvvwxyMPVEi@cluster0.xr2zdvk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

// 🔴 RENDER URL (For Self-Ping - prevents sleeping)
const RENDER_EXTERNAL_URL = "https://aadl-bot-tjym.onrender.com"; 

// --- CONSTANTS FOR SERVICE BUTTON ---
const MY_USERNAME = "gmiyad";
const SERVICE_MSG = encodeURIComponent("تصميم وتطوير المواقع ( متاجر الكترونية ، مواقع شخصية ، مدونات ، ووردبريس )");
const SERVICE_LINK = `https://t.me/${MY_USERNAME}?text=${SERVICE_MSG}`;
// This button row will be added to every menu
const SERVICE_BUTTON_ROW = [{ text: "🛍️ انشئ متجرك الإلكتروني", url: SERVICE_LINK }];

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
setInterval(() => {
    https.get(RENDER_EXTERNAL_URL, (res) => {
        console.log(`🔄 Keep-Alive Ping Sent. Status: ${res.statusCode}`);
    }).on('error', (e) => {
        console.error(`❌ Keep-Alive Error: ${e.message}`);
    });
}, 2 * 60 * 1000); 

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
    telegram_message_id: Number, // Used for the channel deep link
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
    
    // Add Service Button at the bottom
    keyboard.push(SERVICE_BUTTON_ROW);

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
    
    // Add Navigation and Service Buttons
    keyboard.push([{ text: "🔙 الرجوع", callback_data: "MAIN_MENU" }]);
    keyboard.push(SERVICE_BUTTON_ROW);

    bot.sendMessage(chatId, `📂 <b>ولاية: ${wilaya}</b>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
}

// --- MENU 3: LISTINGS (UPDATED FOR FULL LOADING & LINKS) ---
async function sendLocalesList(chatId, selectedWilaya, type) {
    const allItems = await Property.find({ status: 'active', type: type });
    const filteredItems = allItems.filter(item => normalizeWilaya(item.wilaya) === selectedWilaya);

    if (filteredItems.length === 0) {
        bot.sendMessage(chatId, `🚫 لا توجد محلات في ${selectedWilaya}.`, {
            reply_markup: { 
                inline_keyboard: [
                    [{ text: "🔙 الرجوع", callback_data: `WIL:${selectedWilaya}` }],
                    SERVICE_BUTTON_ROW
                ] 
            }
        });
        return;
    }

    // --- BATCH SENDING LOGIC ---
    const BATCH_SIZE = 15; // Send 15 items per message to avoid limits
    
    bot.sendMessage(chatId, `🚀 <b>جاري تحميل ${filteredItems.length} نتيجة...</b>`, { parse_mode: 'HTML' });

    for (let i = 0; i < filteredItems.length; i += BATCH_SIZE) {
        const batch = filteredItems.slice(i, i + BATCH_SIZE);
        let message = "";
        
        // Add header only to the first message
        if (i === 0) {
            message += `📋 <b>قائمة النتائج (${selectedWilaya}):</b>\n\n`;
        }

        batch.forEach((item, index) => {
            // Construct Channel Link: https://t.me/AADLLOCAUX/MESSAGE_ID
            const channelLink = item.telegram_message_id 
                ? `https://t.me/AADLLOCAUX/${item.telegram_message_id}` 
                : `https://t.me/AADLLOCAUX`;

            message += `${i + index + 1}. <b>${item.site}</b>\n`;
            message += `💰 ${item.price} DA\n`;
            
            // --- LINKS ---
            // 1. Google Maps (Inspection)
            if (item.map_link) {
                message += `📍 <a href="${item.map_link}">موقع جوجل (Inspection)</a>\n`;
            }
            // 2. Registration Link
            if (item.link) {
                message += `🔗 <a href="${item.link}">رابط التسجيل (Registration)</a>\n`;
            }
            // 3. Channel Deep Link (To Main Channel)
            message += `📢 <a href="${channelLink}">عرض الإعلان في القناة (View Post)</a>\n\n`;
            
            message += `----------------------------\n\n`;
        });

        // Add "Back" button only to the very last message
        const isLastBatch = (i + BATCH_SIZE) >= filteredItems.length;
        
        const options = {
            parse_mode: 'HTML',
            disable_web_page_preview: true
        };

        if (isLastBatch) {
            options.reply_markup = { 
                inline_keyboard: [
                    [{ text: "🔙 الرجوع", callback_data: `WIL:${selectedWilaya}` }],
                    SERVICE_BUTTON_ROW
                ] 
            };
        }

        await bot.sendMessage(chatId, message, options);
    }
}

// --- HANDLERS ---

// 1. Handle /start (Shows Wilaya Menu)
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await sendWilayaMenu(chatId);
});

// 2. Handle /services or /commands (Sends just the button)
bot.onText(/\/services|\/commands/, (msg) => {
    bot.sendMessage(msg.chat.id, "🚀 <b>خدماتنا:</b>", {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [SERVICE_BUTTON_ROW] }
    });
});

// 3. Handle Callback Queries (Buttons)
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