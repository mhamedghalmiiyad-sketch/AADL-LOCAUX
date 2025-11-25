const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

// --- CONFIGURATION ---
const TELEGRAM_TOKEN = "8567471950:AAEOVaFupM-Z0iepul7Ktu9M_UKVLyNi_wY";
const CHANNEL_ID = "-1003153716891";
const MONGO_URI = "mongodb+srv://AADLLOCAUX:GzYQskvvwxyMPVEi@cluster0.xr2zdvk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

const BASE_DIR = path.join(__dirname, 'aadl_local_data');
const IMAGES_DIR = path.join(BASE_DIR, 'pdfs');

// --- MONGODB SETUP ---
const PropertySchema = new mongoose.Schema({
    id: { type: String, unique: true },
    wilaya: String,
    site: String,
    price: String,
    surface: String,
    type: String,
    link: String,
    map_link: String,
    telegram_message_id: Number,
    status: { type: String, default: 'active' },
    first_seen: Date,
    last_seen: Date
});
const Property = mongoose.model('Property', PropertySchema);

// --- TRANSLATIONS ---
const TYPE_LABELS = {
    "Medical": "Locaux Grés a Grés simple destinés au Corp Médical / بيع عن طريق التراضي خاص بقطاع الصحة",
    "LGG_Simple": "Locaux Grés a Grés simple / بيع عن طريق التراضي",
    "LGG_Terme": "Locaux Grés a Grés a termes / بيع عن طريق التراضي بالتقسيط",
    "Adjudication": "Adjudication / بيع بالمزاد العلني"
};

// --- SETUP ---
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR);
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR);

// --- HELPERS ---
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getSmartTags(wilaya, site, type) {
    const wTag = wilaya ? wilaya.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '') : "Algerie";
    const sTag = site ? site.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '').substring(0, 20) : "Site";
    
    let tTag = "Immobilier";
    if (type.includes("Médical")) tTag = "Medical";
    if (type.includes("Simple")) tTag = "Gre_A_Gre";
    if (type.includes("termes")) tTag = "Termes";
    if (type.includes("Adjudication")) tTag = "Encheres";

    return `#${wTag} #${sTag} #${tTag}`; 
}

function getMapLink(wilaya, site) {
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(`${site}, ${wilaya}, Algérie`);
}

// --- SMART TELEGRAM SENDER ---
async function sendSafeMessage(method, ...args) {
    try {
        return await bot[method](...args);
    } catch (error) {
        if (error.response && error.response.statusCode === 429) {
            const retryAfter = (error.response.body.parameters.retry_after || 10) + 2;
            console.log(`⏳ Telegram Rate Limit! Pausing for ${retryAfter} seconds...`);
            await delay(retryAfter * 1000);
            return sendSafeMessage(method, ...args);
        }
        throw error;
    }
}

// --- PROGRAMS CONFIG ---
const PROGRAMS = [
    { id: "medical", type: "Medical", label: "Corps Médical", url: "https://www.aadl.com.dz/locaux/log_gardient/production/" },
    { id: "lgg_simple", type: "LGG_Simple", label: "Gré à Gré Simple", url: "https://www.aadl.com.dz/locaux/programme_lgg/production/pagewilcom_lgg.php" },
    { id: "lgg_terme", type: "LGG_Terme", label: "Gré à Gré à Terme", url: "https://www.aadl.com.dz/locaux/programme_lgg/production/pagewilcom_ter1.php" },
    { id: "adjudication", type: "Adjudication", label: "Adjudication", url: "https://www.aadl.com.dz/locaux/programme_lgg/production/pagewilcom_adjudication.php", folder: IMAGES_DIR }
];

// --- MAIN EXECUTION ---
(async () => {
    console.log("🚀 Starting AADL Scraper (MongoDB Mode)...");

    // 1. Connect to DB
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB.");

    const browser = await puppeteer.launch({
        headless: false, 
        defaultViewport: null,
        args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox'],
        protocolTimeout: 240000 
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

    // 3. Process SOLD Items (Using DB Queries)
    console.log("🔍 Checking for SOLD items...");
    
    // Find active items that were NOT seen in this run
    const soldItems = await Property.find({ 
        status: 'active', 
        id: { $nin: Array.from(currentRunIds) } 
    });

    let messageBuffer = `❗ <b>تحديث – عقارات لم تعد متوفرة:</b>\n\n`;
    let hasSoldItems = false;

    for (const item of soldItems) {
        // Update in DB
        await Property.updateOne({ id: item.id }, { $set: { status: 'sold', last_seen: new Date() } });
        
        hasSoldItems = true;
        const itemText = `⛔ <b>${item.wilaya}</b> – ${item.site}\n` +
                         `🔖 Code: ${item.id}\n--------------------\n`;

        if ((messageBuffer + itemText).length > 3800) {
            await sendSafeMessage('sendMessage', CHANNEL_ID, messageBuffer + `\n#Sold`, { parse_mode: 'HTML' });
            messageBuffer = `❗ <b>تتمة التحديث:\n\n`;
        }
        messageBuffer += itemText;
    }

    if (hasSoldItems) {
        console.log(`📉 Found ${soldItems.length} items sold.`);
        await sendSafeMessage('sendMessage', CHANNEL_ID, messageBuffer + `\n#Sold`, { parse_mode: 'HTML' });
    }

    console.log("🏁 Job Done. Exiting.");
    await mongoose.disconnect();
    process.exit(0);
})();

// --- SCRAPER: TABLE MODE (UPDATED FOR MONGO) ---
async function scrapeTable(page, config, currentRunIds) {
    try {
        await page.goto(config.url, { waitUntil: 'domcontentloaded' });
    } catch (e) { console.log(`   ⚠️ Timeout loading main URL`); return; }

    // ... (Medical Logic - Same as before) ...
    if (config.id === "medical") {
        try {
            await page.waitForSelector('a[href*="pagewilcom.php"]', { timeout: 5000 });
            const link = await page.$eval('a[href*="pagewilcom.php"]', el => el.href);
            await page.goto(link, { waitUntil: 'domcontentloaded' });
        } catch(e) {}
    }

    try { await page.waitForSelector('select', { timeout: 15000 }); } catch (e) { return; }
    
    const wilayaList = await page.evaluate(() => {
        const s = document.querySelector('select');
        if(!s) return [];
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
            let attempts = 0;
            let success = false;

            while(attempts < 3 && !success) {
                try {
                    attempts++;
                    if (!await page.$('select')) await page.reload({ waitUntil: 'domcontentloaded' });
                    
                    await page.select('select', wilaya.value);
                    await page.select(await page.evaluate(() => {
                        const s = document.querySelectorAll('select')[1];
                        return s.id ? '#'+s.id : 'select:nth-of-type(2)';
                    }), site.value);

                    const btn = await page.$('input[value="search"]');
                    if (!btn) { success = true; continue; } 

                    await Promise.all([
                        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(()=>{}),
                        btn.click()
                    ]);

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
                                price: cols[4]?.innerText.trim(), 
                                surface: cols[3]?.innerText.trim(),
                                type: cLabel, link: link
                            };
                        }).filter(i => i !== null);
                    }, wilaya.text, site.text, config.type);

                    success = true; 

                    for (const item of items) {
                        currentRunIds.add(item.id);

                        // CHECK DB for this item
                        const existingItem = await Property.findOne({ id: item.id });

                        if (!existingItem) {
                            console.log(`🌟 NEW: ${item.id}`);
                            
                            const displayTitle = TYPE_LABELS[config.type] || config.type;
                            const mapUrl = getMapLink(item.wilaya, item.site);
                            const hashtags = getSmartTags(item.wilaya, item.site, config.type);

                            const msg = `🏡 <b>${displayTitle}</b>\n\n` +
                                        `📍 <b>الولاية:</b> ${item.wilaya}\n` +
                                        `🏢 <b>الموقع:</b> ${item.site}\n` +
                                        `💰 <b>السعر:</b> ${item.price} دج\n` +
                                        `📏 <b>المساحة:</b> ${item.surface} m²\n` +
                                        `🆔 <b>Code:</b> ${item.id}\n\n` +
                                        `🔗 <a href="${item.link}">رابط التسجيل</a>\n` +
                                        `🗺️ <a href="${mapUrl}">موقع جوجل ماب</a>\n\n${hashtags}`;
                            
                            const sentMsg = await sendSafeMessage('sendMessage', CHANNEL_ID, msg, { parse_mode: 'HTML', disable_web_page_preview: true });
                            
                            // SAVE NEW TO DB
                            await Property.create({
                                ...item,
                                map_link: mapUrl,
                                telegram_message_id: sentMsg.message_id,
                                status: 'active',
                                first_seen: new Date(),
                                last_seen: new Date()
                            });
                            
                            await delay(1500);
                        } else {
                            // UPDATE timestamp in DB
                            await Property.updateOne({ id: item.id }, { $set: { last_seen: new Date(), status: 'active' } });
                        }
                    }
                } catch (e) { 
                    console.log(`⚠️ Retry ${attempts}/3`);
                    await page.reload({ waitUntil: 'domcontentloaded' });
                    await delay(2000);
                }
            }
        }
    }
}

// --- SCRAPER: PDF MODE (UPDATED FOR MONGO) ---
async function scrapePDFs(page, config, currentRunIds) {
    try { await page.goto(config.url, { waitUntil: 'domcontentloaded' }); } catch (e) { return; }
    try { await page.waitForSelector('select', { timeout: 15000 }); } catch (e) { return; }
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

            // CHECK DB
            const existingItem = await Property.findOne({ id: pdfId });

            if(existingItem) { 
                await Property.updateOne({ id: pdfId }, { $set: { last_seen: new Date(), status: 'active' } });
                continue; 
            }

            // ... (Downloading Logic - Same as before) ...
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
                        
                        const displayTitle = TYPE_LABELS[config.type] || config.type;
                        const mapUrl = getMapLink(w.t, opt.t);
                        const hashtags = getSmartTags(w.t, opt.t, "Adjudication");

                        const sentMsg = await sendSafeMessage('sendDocument', CHANNEL_ID, localPdfPath, {
                            caption: `📢 <b>${displayTitle}</b>\n\n` +
                                     `📍 <b>الولاية:</b> ${w.t}\n` +
                                     `📄 <b>العنوان:</b> ${opt.t}\n` +
                                     `🗺️ <a href="${mapUrl}">موقع جوجل ماب</a>\n\n` +
                                     `${hashtags}`,
                            parse_mode: 'HTML'
                        });

                        // SAVE PDF TO DB
                        await Property.create({
                            id: pdfId, wilaya: w.t, site: opt.t, type: "Adjudication",
                            map_link: mapUrl, telegram_message_id: sentMsg.message_id,
                            status: 'active', first_seen: new Date(), last_seen: new Date()
                        });

                        console.log(`✅ Sent PDF: ${opt.t}`);
                        try { fs.unlinkSync(localPdfPath); } catch (err) {}
                        await delay(3000);
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