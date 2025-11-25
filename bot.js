const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const TELEGRAM_TOKEN = "8567471950:AAEOVaFupM-Z0iepul7Ktu9M_UKVLyNi_wY"; 
const BASE_DIR = path.join(__dirname, 'aadl_local_data');
const HISTORY_FILE = path.join(BASE_DIR, 'history.json');

// --- LABELS ---
const SHORT_LABELS = {
    "Medical": "🩺 Medical (صحة)",
    "LGG_Simple": "🏠 Simple (تراضي)",
    "LGG_Terme": "📅 Terme (بالتقسيط)",
    "Adjudication": "📢 Enchères (مزاد)"
};

// --- SETUP ---
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

console.log("🤖 Interactive Bot is ONLINE. Waiting for users...");

// --- HELPERS ---

function loadHistory() {
    if (fs.existsSync(HISTORY_FILE)) {
        return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
    return {};
}

// 🛠️ HELPER: Standardize Wilaya Names (Removes "16- ", "01- ", etc.)
function normalizeWilaya(rawName) {
    if (!rawName) return "Unknown";
    // Regex: Remove starting digits followed by hyphen or space
    return rawName.replace(/^\d+\s*-\s*/, '').trim();
}

// --- INTERACTION LOGIC ---

// 1. Handle /start
bot.onText(/\/start/, (msg) => {
    sendWilayaMenu(msg.chat.id);
});

// 2. Handle Button Clicks
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    try {
        if (data === 'MAIN_MENU') {
            await sendWilayaMenu(chatId);
        } 
        else if (data.startsWith('WIL:')) {
            const selectedWilaya = data.split('WIL:')[1];
            await sendProgramMenu(chatId, selectedWilaya);
        } 
        else if (data.startsWith('PROG:')) {
            // Data Format: PROG:WilayaName:ProgramType
            const parts = data.split(':');
            const selectedWilaya = parts[1];
            const selectedType = parts[2];
            await sendLocalesList(chatId, selectedWilaya, selectedType);
        }
        
        await bot.answerCallbackQuery(query.id);
    } catch (error) {
        console.error("Callback Error:", error.message);
    }
});

// --- MENU FUNCTIONS ---

async function sendWilayaMenu(chatId) {
    const history = loadHistory();
    
    // 1. Get all raw wilaya names from active items
    const rawWilayas = Object.values(history)
        .filter(item => item.status === 'active')
        .map(item => item.wilaya);

    // 2. Clean them (normalize) and put in a Set to remove duplicates
    const uniqueWilayas = new Set();
    rawWilayas.forEach(w => uniqueWilayas.add(normalizeWilaya(w)));

    // 3. Convert to array and sort alphabetically
    const sortedWilayas = [...uniqueWilayas].sort();

    if (sortedWilayas.length === 0) {
        bot.sendMessage(chatId, "⚠️ لا توجد بيانات متوفرة حاليا.\nDatabase is empty or no active items.");
        return;
    }

    // 4. Build Keyboard
    const keyboard = [];
    for (let i = 0; i < sortedWilayas.length; i += 2) {
        const row = [{ text: sortedWilayas[i], callback_data: `WIL:${sortedWilayas[i]}` }];
        if (sortedWilayas[i+1]) {
            row.push({ text: sortedWilayas[i+1], callback_data: `WIL:${sortedWilayas[i+1]}` });
        }
        keyboard.push(row);
    }
    
    bot.sendMessage(chatId, "🇩🇿 <b>مرحباً! اختر الولاية:</b>\nSelect a Wilaya:", {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
    });
}

async function sendProgramMenu(chatId, wilaya) {
    const programs = [
        { id: "Medical", text: SHORT_LABELS["Medical"] },
        { id: "LGG_Simple", text: SHORT_LABELS["LGG_Simple"] },
        { id: "LGG_Terme", text: SHORT_LABELS["LGG_Terme"] },
        { id: "Adjudication", text: SHORT_LABELS["Adjudication"] }
    ];

    const keyboard = programs.map(p => [{ text: p.text, callback_data: `PROG:${wilaya}:${p.id}` }]);
    keyboard.push([{ text: "🔙 الرجوع (Back)", callback_data: "MAIN_MENU" }]);

    bot.sendMessage(chatId, `📂 <b>ولاية: ${wilaya}</b>\nاختر البرنامج:\nSelect Program:`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
    });
}

async function sendLocalesList(chatId, selectedWilaya, type) {
    const history = loadHistory();
    
    // FILTER LOGIC: Match the NORMALIZED name
    const items = Object.values(history).filter(item => {
        const itemWilayaClean = normalizeWilaya(item.wilaya); // Clean the database value
        return item.status === 'active' && 
               itemWilayaClean === selectedWilaya && // Compare with user selection
               item.type === type;
    });

    if (items.length === 0) {
        bot.sendMessage(chatId, `🚫 لا توجد محلات لهذا النوع في ${selectedWilaya}.`, {
            reply_markup: { inline_keyboard: [[{ text: "🔙 الرجوع", callback_data: `WIL:${selectedWilaya}` }]] }
        });
        return;
    }

    let message = `📋 <b>النتائج في ${selectedWilaya} (${items.length}):</b>\n\n`;
    
    items.slice(0, 10).forEach((item, index) => {
        message += `${index + 1}. <b>${item.site}</b>\n`;
        message += `   💰 ${item.price} DA | 📏 ${item.surface}m²\n`;
        message += `   🔗 <a href="${item.link}">رابط التسجيل</a>\n`;
        message += `   🗺️ <a href="${item.map_link || '#'}">Google Maps</a>\n\n`;
    });

    if (items.length > 10) message += `<i>... و ${items.length - 10} آخرين.</i>`;

    bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: { 
            inline_keyboard: [[{ text: "🔙 الرجوع", callback_data: `WIL:${selectedWilaya}` }]] 
        }
    });
}