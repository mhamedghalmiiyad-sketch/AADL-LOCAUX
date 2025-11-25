const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
// 🔴 SECURITY WARNING: In a real app, use Environment Variables. 
// Since you are learning, I put it here for ease of use.
const MONGO_URI = "mongodb+srv://AADLLOCAUX:GzYQskvvwxyMPVEi@cluster0.xr2zdvk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

const BASE_DIR = path.join(__dirname, 'aadl_local_data');
const HISTORY_FILE = path.join(BASE_DIR, 'history.json');

// --- DATABASE SCHEMA ---
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

// --- MIGRATION LOGIC ---
(async () => {
    console.log("🚀 Starting Migration from JSON to MongoDB...");

    if (!fs.existsSync(HISTORY_FILE)) {
        console.error("❌ history.json not found!");
        process.exit(1);
    }

    try {
        await mongoose.connect(MONGO_URI);
        console.log("✅ Connected to MongoDB.");

        const rawData = fs.readFileSync(HISTORY_FILE, 'utf8');
        const history = JSON.parse(rawData);
        const items = Object.values(history);

        console.log(`📦 Found ${items.length} items in history.json. Uploading...`);

        // Bulk Write is faster for migration
        const bulkOps = items.map(item => ({
            updateOne: {
                filter: { id: item.id },
                update: { $set: item },
                upsert: true // Insert if it doesn't exist, update if it does
            }
        }));

        if (bulkOps.length > 0) {
            const result = await Property.bulkWrite(bulkOps);
            console.log(`🎉 Migration Complete!`);
            console.log(`   - Matched: ${result.matchedCount}`);
            console.log(`   - Modified: ${result.modifiedCount}`);
            console.log(`   - Upserted: ${result.upsertedCount}`);
        } else {
            console.log("⚠️ No items to migrate.");
        }

    } catch (error) {
        console.error("❌ Migration Failed:", error);
    } finally {
        await mongoose.disconnect();
        console.log("👋 Connection Closed.");
    }
})();