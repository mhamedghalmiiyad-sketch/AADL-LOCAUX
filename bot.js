const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

// --- ENV VARIABLES ---
// Set these in Render Dashboard
const MONGO_URI = process.env.MONGO_URI || "YOUR_MONGODB_CONNECTION_STRING";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "YOUR_TELEGRAM_BOT_TOKEN";
const CHANNEL_ID = process.env.CHANNEL_ID || "YOUR_CHANNEL_ID";

// --- SETUP ---
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });
const BASE_DIR = path.join(__dirname, 'aadl_data');
const IMAGES_DIR = path.join(BASE_DIR, 'pdfs');

if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR);
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR);

// --- MONGODB SCHEMA (Updated with Map Link) ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

const ItemSchema = new mongoose.Schema({
    id: String, 
    wilaya: String,
    site: String,
    type: String, 
    price: String,
    surface: String,
    link: String,
    map_link: String, // Added Map Link storage
    pdf_path: String, 
    status: String, 
    first_seen: Date,
    last_seen: Date
});
const ItemModel = mongoose.model('HousingItem', ItemSchema);

// --- CONFIG ---
const PROGRAMS = [
    { id: "medical", type: "Medical", label: "Corps Médical", url: "https://www.aadl.com.dz/locaux/log_gardient/production/" },
    { id: "lgg_simple", type: "LGG_Simple", label: "Gré à Gré Simple", url: "https://www.aadl.com.dz/locaux/programme_lgg/production/pagewilcom_lgg.php" },
    { id: "lgg_terme", type: "LGG_Terme", label: "Gré à Gré à Terme", url: "https://www.aadl.com.dz/locaux/programme_lgg/production/pagewilcom_ter1.php" },
    { id: "adjudication", type: "Adjudication", label: "Adjudication", url: "https://www.aadl.com.dz/locaux/programme_lgg/production/pagewilcom_adjudication.php", folder: IMAGES_DIR }
];

// --- HELPER: SMART HASHTAGS & MAPS ---
function getSmartTags(wilaya, site, type, extra = "") {
    // Remove spaces and special chars for hashtags
    const wTag = wilaya.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '');
    const sTag = site.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '').substring(0, 20); // Limit length
    const tTag = type.replace(/\s+/g, '_');
    return `#${wTag} #${sTag} #${tTag} #AADL ${extra}`;
}

function getMapLink(wilaya, site) {
    // Generates a clickable Google Maps Search Link
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(`${site}, ${wilaya}, Algérie`);
}

// --- MAIN EXECUTION ---
(async () => {
    console.log("🚀 Starting AADL Daily Bot v18 (Arabic + Maps + Hashtags)...");
    
    // 1. Load OLD Active Items
    const oldItems = await ItemModel.find({ status: 'active' });
    
    // 2. Launch Browser
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    let currentRunIds = new Set(); 

    for (const program of PROGRAMS) {
        console.log(`📂 Scanning: ${program.label}`);
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(180000); 

        try {
            if (program.id === "adjudication") {
                await scrapePDFs(page, program, currentRunIds);
            } else {
                await scrapeTable(page, program, currentRunIds);
            }
        } catch (e) {
            console.error(`❌ Error in ${program.label}: ${e.message}`);
        } finally {
            await page.close();
        }
    }

    await browser.close();

    // 3. Process SOLD Items (Arabic Update)
    const soldItems = oldItems.filter(item => !currentRunIds.has(item.id));
    
    if (soldItems.length > 0) {
        console.log(`📉 Found ${soldItems.length} items sold.`);
        
        // We group them to avoid spamming 100 messages, but format is Arabic
        // If there are too many, we send a digest. If few, we stick to the template.
        
        let messageBuffer = `❗ <b>تحديث – عقارات لم تعد متوفرة:</b>\n\n`;
        
        for (const item of soldItems) {
            item.status = 'sold';
            item.last_seen = new Date();
            await item.save();

            const itemText = `⛔ <b>${item.wilaya}</b> – ${item.site}\n` +
                             `🔖 الرمز: ${item.id}\n` + 
                             `--------------------\n`;
            
            // If message gets too long (Telegram limit 4096), send and restart
            if ((messageBuffer + itemText).length > 3800) {
                await bot.sendMessage(CHANNEL_ID, messageBuffer + `\n#AADL #Sold`, { parse_mode: 'HTML' });
                messageBuffer = `❗ <b>تتمة التحديث:\n\n`;
            }
            messageBuffer += itemText;
        }
        
        // Send remaining buffer with generic tags (Specific tags for 50 items is messy)
        await bot.sendMessage(CHANNEL_ID, messageBuffer + `\n#Algerie #AADL #Sold`, { parse_mode: 'HTML' });
    }

    console.log("🏁 Job Done. Exiting.");
    process.exit(0);
})();

// --- SCRAPER: TABLE MODE ---
async function scrapeTable(page, config, currentRunIds) {
    await page.goto(config.url, { waitUntil: 'domcontentloaded' });

    if (config.id === "medical") {
        try {
            await page.waitForSelector('a[href*="pagewilcom.php"]', { timeout: 5000 });
            const link = await page.$eval('a[href*="pagewilcom.php"]', el => el.href);
            await page.goto(link, { waitUntil: 'domcontentloaded' });
        } catch(e) {}
    }

    await page.waitForSelector('select', { timeout: 15000 });
    const wilayaList = await page.evaluate(() => {
        const s = document.querySelector('select');
        return Array.from(s.options).filter(o => o.value > 0).map(o => ({ value: o.value, text: o.text.trim() }));
    });

    for (const wilaya of wilayaList) {
        const validSites = await page.evaluate((wVal) => {
            const s = document.querySelectorAll('select')[1]; 
            if (!s) return [];
            return Array.from(s.options)
                .filter(o => o.classList.contains(wVal))
                .map(o => ({ value: o.value, text: o.text.trim() }));
        }, wilaya.value);

        if (validSites.length === 0) continue;

        for (const site of validSites) {
            try {
                if (!await page.$('select')) await page.reload({ waitUntil: 'domcontentloaded' });
                await page.select('select', wilaya.value);
                
                await page.select(await page.evaluate(() => {
                    const s = document.querySelectorAll('select')[1];
                    return s.id ? '#'+s.id : 'select:nth-of-type(2)';
                }), site.value);

                const btn = await page.$('input[value="search"]');
                if (!btn) continue;

                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(()=>{}),
                    btn.click()
                ]);

                // Extract Items
                const items = await page.evaluate((wName, sName, cLabel) => {
                    const rows = Array.from(document.querySelectorAll('table tbody tr'));
                    return rows.map(row => {
                        const cols = row.querySelectorAll('td');
                        if (cols.length < 5 || cols[0].innerText.includes('Code')) return null;
                        
                        const code = cols[0].innerText.trim();
                        const action = cols[cols.length-1].innerText.toLowerCase();
                        if (action.includes('clôturée') || action.includes('vendu')) return null;

                        const form = row.querySelector('form');
                        let link = "";
                        if (form) {
                            const pathArr = document.location.href.split('/'); pathArr.pop();
                            const params = Array.from(form.querySelectorAll('input'))
                                .filter(i => i.name && i.value && i.type !== 'submit')
                                .map(i => `${encodeURIComponent(i.name)}=${encodeURIComponent(i.value)}`);
                            link = `${pathArr.join('/')}/inscription.php?${params.join('&')}`;
                        }

                        return {
                            id: code, wilaya: wName, site: sName,
                            price: cols[4]?.innerText.trim(), surface: cols[3]?.innerText.trim(),
                            type: cLabel, link: link
                        };
                    }).filter(i => i !== null);
                }, wilaya.text, site.text, config.type);

                // --- PROCESS & SEND MESSAGES ---
                for (const item of items) {
                    currentRunIds.add(item.id);

                    const exists = await ItemModel.findOne({ id: item.id });
                    
                    if (!exists) {
                        console.log(`🌟 NEW: ${item.id}`);
                        
                        // Generate Map Link & Hashtags
                        const mapUrl = getMapLink(item.wilaya, item.site);
                        const hashtags = getSmartTags(item.wilaya, item.site, item.type);

                        await ItemModel.create({
                            ...item,
                            map_link: mapUrl,
                            status: 'active',
                            first_seen: new Date(),
                            last_seen: new Date()
                        });

                        // 📩 ARABIC MESSAGE TEMPLATE
                        const msg = `🏡 <b>عقار جديد – (${item.type})</b>\n\n` +
                                    `📍 <b>الولاية:</b> ${item.wilaya}\n` +
                                    `🏢 <b>الموقع:</b> ${item.site}\n` +
                                    `💰 <b>السعر:</b> ${item.price}\n` +
                                    `📏 <b>المساحة:</b> ${item.surface}\n` +
                                    `🆔 <b>الرمز:</b> ${item.id}\n\n` +
                                    `🔗 <a href="${item.link}">رابط التسجيل</a>\n` +
                                    `🗺️ <a href="${mapUrl}">موقع جوجل ماب (Google Maps)</a>\n\n` +
                                    `${hashtags}`;
                        
                        await bot.sendMessage(CHANNEL_ID, msg, { parse_mode: 'HTML', disable_web_page_preview: true });
                    } else {
                        exists.last_seen = new Date();
                        exists.status = 'active';
                        await exists.save();
                    }
                }
            } catch (e) { console.log(`Skipping site error: ${e.message}`); }
        }
    }
}

// --- SCRAPER: PDF MODE ---
async function scrapePDFs(page, config, currentRunIds) {
    await page.goto(config.url, { waitUntil: 'domcontentloaded' });
    
    await page.waitForSelector('select', { timeout: 15000 });
    const wilayas = await page.evaluate(() => Array.from(document.querySelectorAll('select')[0].options).filter(o => o.value).map(o => ({v:o.value, t:o.text.trim()})));

    for(const w of wilayas) {
        const wDir = path.join(config.folder, w.t.replace(/[^a-z0-9]/gi, ''));
        if (!fs.existsSync(wDir)) fs.mkdirSync(wDir);

        await page.goto(config.url);
        await page.select('select', w.v);
        await new Promise(r => setTimeout(r, 2000));
        
        const opts = await page.evaluate(() => Array.from(document.querySelectorAll('select')[1].options).filter(o => o.value).map(o => ({v:o.value, t:o.text.trim()})));

        for(const opt of opts) {
            if(opt.t.toLowerCase().includes('clôturée') || !opt.t.toLowerCase().includes(w.t.toLowerCase().substring(0,4))) continue;
            
            const pdfId = `PDF-${opt.t.substring(0, 20).replace(/\s/g, '')}`;
            currentRunIds.add(pdfId);

            const exists = await ItemModel.findOne({ id: pdfId });
            if(exists) { 
                exists.last_seen = new Date(); exists.status = 'active'; await exists.save(); 
                continue; 
            }

            try {
                await page.goto(config.url);
                await page.select('select', w.v);
                await new Promise(r => setTimeout(r, 1000));
                
                await page.evaluate((val) => {
                    const s = document.querySelectorAll('select')[1];
                    s.value = val; s.dispatchEvent(new Event('change'));
                }, opt.v);

                const btn = await page.$('input[type="submit"]');
                if(btn) {
                    await btn.click();
                    await new Promise(r => setTimeout(r, 3000));
                    
                    const pdfUrl = await page.evaluate(() => {
                        const a = Array.from(document.querySelectorAll('a')).find(l => l.href.endsWith('.pdf'));
                        return a ? a.href : null;
                    });

                    if(pdfUrl) {
                        const localPdfPath = path.join(wDir, `${pdfId}.pdf`);
                        await downloadFile(pdfUrl, localPdfPath);
                        
                        const mapUrl = getMapLink(w.t, opt.t);
                        const hashtags = getSmartTags(w.t, opt.t, "Adjudication");

                        await ItemModel.create({
                            id: pdfId, wilaya: w.t, site: opt.t, type: "Adjudication",
                            map_link: mapUrl, pdf_path: localPdfPath,
                            status: 'active', first_seen: new Date(), last_seen: new Date()
                        });

                        // 📩 PDF ARABIC MESSAGE
                        await bot.sendDocument(CHANNEL_ID, localPdfPath, {
                            caption: `📢 <b>إعلان مناقصة جديد</b>\n\n` +
                                     `📍 <b>الولاية:</b> ${w.t}\n` +
                                     `📄 <b>العنوان:</b> ${opt.t}\n` +
                                     `🗺️ <a href="${mapUrl}">موقع جوجل ماب</a>\n\n` +
                                     `${hashtags}`,
                            parse_mode: 'HTML'
                        });
                        console.log(`✅ Sent PDF: ${opt.t}`);
                    }
                }
            } catch(e) { console.log(`PDF Error: ${e.message}`); }
        }
    }
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, { rejectUnauthorized: false }, (res) => {
            res.pipe(file);
            file.on('finish', () => file.close(resolve));
        }).on('error', (e) => reject(e));
    });
}