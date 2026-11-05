const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const dir = __dirname;
fs.mkdirSync(dir, { recursive: true });
const db = new Database(path.join(dir, 'dream-estate.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS admins (
 id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS properties (
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT DEFAULT '',
 location TEXT NOT NULL, address TEXT DEFAULT '', latitude REAL, longitude REAL,
 type TEXT NOT NULL DEFAULT 'Land Plot', purpose TEXT NOT NULL DEFAULT 'Sale',
 price REAL NOT NULL, market_value REAL, price_per_sqft REAL, area_sqft REAL NOT NULL,
 area_unit TEXT DEFAULT 'sq.ft', status TEXT NOT NULL DEFAULT 'Available',
 water_available INTEGER DEFAULT 0, electricity_available INTEGER DEFAULT 0, road_access INTEGER DEFAULT 0, facing TEXT DEFAULT '', length_ft REAL, width_ft REAL,
 amenities TEXT DEFAULT '[]', nearby_facilities TEXT DEFAULT '[]',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS property_images (
 id INTEGER PRIMARY KEY AUTOINCREMENT, property_id INTEGER NOT NULL,
 image_path TEXT NOT NULL, alt_text TEXT DEFAULT '',
 FOREIGN KEY(property_id) REFERENCES properties(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS property_amenities (
 id INTEGER PRIMARY KEY AUTOINCREMENT, property_id INTEGER NOT NULL, amenity TEXT NOT NULL,
 FOREIGN KEY(property_id) REFERENCES properties(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS nearby_facilities (
 id INTEGER PRIMARY KEY AUTOINCREMENT, property_id INTEGER NOT NULL,
 name TEXT NOT NULL, category TEXT NOT NULL, distance_km REAL, source TEXT DEFAULT '', verified_at TEXT,
 FOREIGN KEY(property_id) REFERENCES properties(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS customers (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL,
 email TEXT NOT NULL, address TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS enquiries (
 id INTEGER PRIMARY KEY AUTOINCREMENT, enquiry_code TEXT UNIQUE NOT NULL,
 property_id INTEGER, customer_id INTEGER NOT NULL, budget REAL, preferred_location TEXT,
 requirements TEXT DEFAULT '', message TEXT DEFAULT '', status TEXT DEFAULT 'New', admin_notes TEXT DEFAULT '',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(property_id) REFERENCES properties(id) ON DELETE SET NULL,
 FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS property_locations (
 id INTEGER PRIMARY KEY AUTOINCREMENT, property_id INTEGER NOT NULL UNIQUE,
 latitude REAL NOT NULL, longitude REAL NOT NULL,
 FOREIGN KEY(property_id) REFERENCES properties(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_location ON properties(location);
CREATE INDEX IF NOT EXISTS idx_enquiries_created ON enquiries(created_at);
`);
// Safe upgrade for databases created by earlier Dream Estate versions.
const enquiryColumns = db.prepare('PRAGMA table_info(enquiries)').all().map(c => c.name);
if (!enquiryColumns.includes('admin_notes')) db.exec("ALTER TABLE enquiries ADD COLUMN admin_notes TEXT DEFAULT ''");
const propertyColumns = db.prepare('PRAGMA table_info(properties)').all().map(c => c.name);
for (const [name, definition] of [['electricity_available','INTEGER DEFAULT 0'],['facing',"TEXT DEFAULT ''"],['length_ft','REAL'],['width_ft','REAL']]) if (!propertyColumns.includes(name)) db.exec(`ALTER TABLE properties ADD COLUMN ${name} ${definition}`);
module.exports = db;
