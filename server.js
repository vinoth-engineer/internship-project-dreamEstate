require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const compression = require('compression');
const db = require('./database/db');
const { sendEnquiryEmail } = require('./utils/email');
// Create the first administrator once; set ADMIN_USERNAME and ADMIN_PASSWORD in .env before first run.
if (!db.prepare('SELECT id FROM admins LIMIT 1').get()) {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'ChangeThisPassword123!';
  db.prepare('INSERT INTO admins(username,password_hash) VALUES(?,?)').run(username, bcrypt.hashSync(password, 12));
  console.log(`Initial admin account created for username: ${username}`);
}
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET must be set in production.');
const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, 'public');
const uploadDir = path.join(publicDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(session({ store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname, 'database') }), name: 'dreamestate.sid', secret: process.env.SESSION_SECRET || 'development-only-change-this-secret-replace-before-deploy', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 2 * 60 * 60 * 1000 } }));
app.use(express.static(publicDir));
const adminLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false });
const enquiryLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const storage = multer.diskStorage({ destination: uploadDir, filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${path.extname(file.originalname).toLowerCase()}`) });
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024, files: 8 }, fileFilter: (req, file, cb) => /^image\/(jpeg|png|webp|avif)$/.test(file.mimetype) ? cb(null, true) : cb(new Error('Only JPEG, PNG, WebP and AVIF images are allowed.')) });
const adminOnly = (req, res, next) => req.session.adminId ? next() : res.status(401).json({ error: 'Admin login required.' });
const safeJson = (s, fallback = []) => { try { return JSON.parse(s || ''); } catch { return fallback; } };
function propertyRow(row) {
  if (!row) return null;
  const images = db.prepare('SELECT image_path FROM property_images WHERE property_id=?').all(row.id).map(x => x.image_path);
  const facilities = db.prepare('SELECT name,category,distance_km,source,verified_at FROM nearby_facilities WHERE property_id=?').all(row.id);
  const imageRecords = db.prepare('SELECT id,image_path,alt_text FROM property_images WHERE property_id=?').all(row.id);
  return { ...row, amenities: safeJson(row.amenities), nearby_facilities: facilities, images, image_records: imageRecords };
}
function cleanText(v, max = 2000) { return String(v ?? '').trim().slice(0, max); }
function validateCustomer(b) {
  const errors = [];
  if (cleanText(b.name, 100).length < 2) errors.push('Enter your full name.');
  if (!/^\+?[0-9\s()-]{8,18}$/.test(cleanText(b.phone, 25))) errors.push('Enter a valid phone number.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanText(b.email, 150))) errors.push('Enter a valid email address.');
  if (cleanText(b.address, 300).length < 5) errors.push('Enter your complete address.');
  if (b.budget !== undefined && b.budget !== '' && (!Number.isFinite(Number(b.budget)) || Number(b.budget) < 0)) errors.push('Enter a valid non-negative budget.');
  return errors;
}
function propertyValues(p) { const { nearby_facilities, ...values } = p; return values; }
function propertyInput(b) {
  const title = cleanText(b.title, 120), location = cleanText(b.location, 180);
  const price = Number(b.price), area = Number(b.area_sqft);
  const lat = b.latitude === '' || b.latitude == null ? null : Number(b.latitude);
  const lon = b.longitude === '' || b.longitude == null ? null : Number(b.longitude);
  if (!title || !location) throw new Error('Title and location are required.');
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(area) || area <= 0) throw new Error('Enter a valid price and land area.');
  if ((lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) || (lon !== null && (!Number.isFinite(lon) || lon < -180 || lon > 180))) throw new Error('Latitude or longitude is invalid.');
  const status = ['Available', 'Under Review', 'Reserved', 'Sold'].includes(b.status) ? b.status : 'Available';
  const type = ['Land Plot', 'Agricultural Land', 'Apartment', 'Villa', 'Independent House', 'Commercial'].includes(b.type) ? b.type : 'Land Plot';
  const amenities = cleanText(b.amenities, 1000).split(',').map(x => x.trim()).filter(Boolean).slice(0, 30);
  const marketValue = b.market_value === '' || b.market_value == null ? null : Number(b.market_value);
  const length = b.length_ft === '' || b.length_ft == null ? null : Number(b.length_ft);
  const width = b.width_ft === '' || b.width_ft == null ? null : Number(b.width_ft);
  if ((length !== null && (!Number.isFinite(length) || length <= 0)) || (width !== null && (!Number.isFinite(width) || width <= 0))) throw new Error('Enter valid positive land dimensions.');
  const nearbyFacilities = cleanText(b.nearby_facilities, 3000).split('\n').map(line => line.trim()).filter(Boolean).slice(0, 30).map(line => { const [name, category, distance, source, verified] = line.split('|').map(x => String(x || '').trim()); return { name: cleanText(name, 120), category: cleanText(category, 60), distance_km: distance ? Number(distance) : null, source: cleanText(source, 200), verified_at: cleanText(verified, 40) }; }).filter(x => x.name && x.category && (x.distance_km === null || (Number.isFinite(x.distance_km) && x.distance_km >= 0)));

  const pps = b.price_per_sqft === '' || b.price_per_sqft == null ? price / area : Number(b.price_per_sqft);
  return { title, description: cleanText(b.description, 3000), location, address: cleanText(b.address, 300), latitude: lat, longitude: lon, type, purpose: 'Sale', price, market_value: Number.isFinite(marketValue) ? marketValue : null, price_per_sqft: Number.isFinite(pps) ? pps : price / area, area_sqft: area, area_unit: 'sq.ft', status, water_available: b.water_available === '1' || b.water_available === true ? 1 : 0, electricity_available: b.electricity_available === '1' || b.electricity_available === true ? 1 : 0, facing: cleanText(b.facing, 40), length_ft: length, width_ft: width, nearby_facilities: nearbyFacilities, road_access: b.road_access === '1' || b.road_access === true ? 1 : 0, amenities };
}
app.get('/api/health', (req, res) => res.json({ ok: true, database: 'SQLite' }));
app.get('/api/properties', (req, res) => {
  const q = cleanText(req.query.q, 100), location = cleanText(req.query.location, 100);
  let sql = 'SELECT * FROM properties WHERE 1=1', args = [];
  if (q) { sql += ' AND (title LIKE ? OR location LIKE ? OR description LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (location) { sql += ' AND location LIKE ?'; args.push(`%${location}%`); }
  if (req.query.status) { sql += ' AND status=?'; args.push(req.query.status); }
  if (req.query.type) { sql += ' AND type=?'; args.push(req.query.type); }
  if (req.query.minPrice !== undefined && req.query.minPrice !== '') { sql += ' AND price>=?'; args.push(Number(req.query.minPrice) || 0); }
  if (req.query.maxPrice !== undefined && req.query.maxPrice !== '') { sql += ' AND price<=?'; args.push(Number(req.query.maxPrice) || 1e15); }
  if (req.query.water === '1') sql += ' AND water_available=1';
  if (req.query.electricity === '1') sql += ' AND electricity_available=1';
  if (req.query.minArea !== undefined && req.query.minArea !== '') { sql += ' AND area_sqft>=?'; args.push(Number(req.query.minArea) || 0); }
  if (req.query.maxArea !== undefined && req.query.maxArea !== '') { sql += ' AND area_sqft<=?'; args.push(Number(req.query.maxArea) || 1e15); }
  if (req.query.road === '1') sql += ' AND road_access=1';
  if (req.query.facing) { sql += ' AND LOWER(facing)=LOWER(?)'; args.push(cleanText(req.query.facing, 40)); }
  sql += req.query.sort === 'price-asc' ? ' ORDER BY price ASC' : req.query.sort === 'price-desc' ? ' ORDER BY price DESC' : req.query.sort === 'area-desc' ? ' ORDER BY area_sqft DESC' : ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...args).map(propertyRow);
  res.json({ properties: rows });
});
app.get('/api/properties/:id', (req, res) => { const p = propertyRow(db.prepare('SELECT * FROM properties WHERE id=?').get(Number(req.params.id))); p ? res.json({ property: p }) : res.status(404).json({ error: 'Property not found.' }); });
app.get('/api/stats', (req, res) => res.json({ total: db.prepare('SELECT COUNT(*) n FROM properties').get().n, available: db.prepare("SELECT COUNT(*) n FROM properties WHERE status='Available'").get().n, underReview: db.prepare("SELECT COUNT(*) n FROM properties WHERE status='Under Review'").get().n, reserved: db.prepare("SELECT COUNT(*) n FROM properties WHERE status='Reserved'").get().n, sold: db.prepare("SELECT COUNT(*) n FROM properties WHERE status='Sold'").get().n, enquiries: db.prepare('SELECT COUNT(*) n FROM enquiries').get().n }));
app.post('/api/enquiries', enquiryLimiter, async (req, res) => {
  const b = req.body || {}, errors = validateCustomer(b);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });
  const propertyId = b.property_id ? Number(b.property_id) : null;
  const property = propertyId ? db.prepare('SELECT id,title FROM properties WHERE id=?').get(propertyId) : null;
  if (propertyId && !property) return res.status(404).json({ error: 'Selected property was not found.' });
  const code = `DE-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const create = db.transaction(() => {
    const c = db.prepare('INSERT INTO customers(name,phone,email,address) VALUES(?,?,?,?)').run(cleanText(b.name, 100), cleanText(b.phone, 25), cleanText(b.email, 150), cleanText(b.address, 300));
    const e = db.prepare('INSERT INTO enquiries(enquiry_code,property_id,customer_id,budget,preferred_location,requirements,message) VALUES(?,?,?,?,?,?,?)').run(code, propertyId, c.lastInsertRowid, Number(b.budget) || null, cleanText(b.preferred_location, 150), cleanText(b.requirements, 1000), cleanText(b.message, 2000));
    return e.lastInsertRowid;
  });
  const enquiryId = create();
  let email = { sent: false, reason: 'SMTP is not configured' };
  try { email = await sendEnquiryEmail({ code, name: cleanText(b.name), phone: cleanText(b.phone), email: cleanText(b.email), budget: b.budget, requirements: b.requirements, message: b.message, propertyTitle: property?.title }); } catch (err) { console.error('Email notification failed:', err.message); email = { sent: false, reason: 'Email delivery failed; enquiry is saved.' }; }
  res.status(201).json({ success: true, enquiryId, enquiryCode: code, message: 'Your enquiry has been submitted successfully. Our team will contact you shortly.', emailSent: email.sent, emailNote: email.sent ? 'Administrator email sent.' : 'Enquiry saved; email notification is not currently available.' });
});
app.get('/api/admin/session', (req, res) => res.json({ authenticated: !!req.session.adminId }));
app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
  const username = cleanText(req.body.username, 80), password = String(req.body.password || '');
  const admin = db.prepare('SELECT * FROM admins WHERE username=?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) return res.status(401).json({ error: 'Invalid username or password.' });
  req.session.adminId = admin.id; req.session.adminUsername = admin.username; res.json({ success: true });
});
app.put('/api/admin/credentials', adminOnly, (req, res) => { const username = cleanText(req.body.username, 80), password = String(req.body.password || ''); if (username.length < 3 || password.length < 12) return res.status(400).json({ error: 'Username must be at least 3 characters and password at least 12 characters.' }); try { db.prepare('UPDATE admins SET username=?,password_hash=? WHERE id=?').run(username, bcrypt.hashSync(password, 12), req.session.adminId); req.session.adminUsername = username; res.json({ success: true }); } catch (e) { res.status(409).json({ error: 'That username is already in use.' }); } });
app.post('/api/admin/logout', adminOnly, (req, res) => req.session.destroy(() => res.json({ success: true })));
app.get('/api/admin/overview', adminOnly, (req, res) => res.json({ total: db.prepare('SELECT COUNT(*) n FROM properties').get().n, available: db.prepare("SELECT COUNT(*) n FROM properties WHERE status='Available'").get().n, underReview: db.prepare("SELECT COUNT(*) n FROM properties WHERE status='Under Review'").get().n, reserved: db.prepare("SELECT COUNT(*) n FROM properties WHERE status='Reserved'").get().n, sold: db.prepare("SELECT COUNT(*) n FROM properties WHERE status='Sold'").get().n, enquiries: db.prepare('SELECT COUNT(*) n FROM enquiries').get().n, recent: db.prepare(`SELECT e.id,e.enquiry_code,e.status,e.created_at,c.name,c.phone,c.email,p.title property_title FROM enquiries e JOIN customers c ON c.id=e.customer_id LEFT JOIN properties p ON p.id=e.property_id ORDER BY e.created_at DESC LIMIT 8`).all() }));
app.get('/api/admin/properties', adminOnly, (req, res) => res.json({ properties: db.prepare('SELECT * FROM properties ORDER BY created_at DESC').all().map(propertyRow) }));
app.post('/api/admin/properties', adminOnly, upload.array('photos', 8), (req, res) => {
  try { const p = propertyInput(req.body); const run = db.transaction(() => { const r = db.prepare(`INSERT INTO properties(title,description,location,address,latitude,longitude,type,purpose,price,market_value,price_per_sqft,area_sqft,area_unit,status,water_available,electricity_available,road_access,facing,length_ft,width_ft,amenities) VALUES(@title,@description,@location,@address,@latitude,@longitude,@type,@purpose,@price,@market_value,@price_per_sqft,@area_sqft,@area_unit,@status,@water_available,@electricity_available,@road_access,@facing,@length_ft,@width_ft,@amenities)`).run({ ...propertyValues(p), amenities: JSON.stringify(p.amenities) }); for (const f of req.files || []) db.prepare('INSERT INTO property_images(property_id,image_path,alt_text) VALUES(?,?,?)').run(r.lastInsertRowid, `/uploads/${f.filename}`, p.title); for (const f of p.nearby_facilities) db.prepare('INSERT INTO nearby_facilities(property_id,name,category,distance_km,source,verified_at) VALUES(?,?,?,?,?,?)').run(r.lastInsertRowid, f.name, f.category, f.distance_km, f.source, f.verified_at || null); if (p.latitude !== null && p.longitude !== null) db.prepare('INSERT INTO property_locations(property_id,latitude,longitude) VALUES(?,?,?)').run(r.lastInsertRowid, p.latitude, p.longitude); return r.lastInsertRowid; }); res.status(201).json({ success: true, id: run() }); } catch (e) { for (const f of req.files || []) fs.unlink(f.path, () => { }); res.status(400).json({ error: e.message }); }
});
app.put('/api/admin/properties/:id', adminOnly, upload.array('photos', 8), (req, res) => {
  try { const id = Number(req.params.id), old = db.prepare('SELECT * FROM properties WHERE id=?').get(id); if (!old) return res.status(404).json({ error: 'Property not found.' }); const p = propertyInput(req.body); db.prepare(`UPDATE properties SET title=@title,description=@description,location=@location,address=@address,latitude=@latitude,longitude=@longitude,type=@type,purpose=@purpose,price=@price,market_value=@market_value,price_per_sqft=@price_per_sqft,area_sqft=@area_sqft,area_unit=@area_unit,status=@status,water_available=@water_available,electricity_available=@electricity_available,road_access=@road_access,facing=@facing,length_ft=@length_ft,width_ft=@width_ft,amenities=@amenities,updated_at=CURRENT_TIMESTAMP WHERE id=@id`).run({ ...propertyValues(p), amenities: JSON.stringify(p.amenities), id }); for (const f of req.files || []) db.prepare('INSERT INTO property_images(property_id,image_path,alt_text) VALUES(?,?,?)').run(id, `/uploads/${f.filename}`, p.title); db.prepare('DELETE FROM nearby_facilities WHERE property_id=?').run(id); for (const f of p.nearby_facilities) db.prepare('INSERT INTO nearby_facilities(property_id,name,category,distance_km,source,verified_at) VALUES(?,?,?,?,?,?)').run(id, f.name, f.category, f.distance_km, f.source, f.verified_at || null); db.prepare('DELETE FROM property_locations WHERE property_id=?').run(id); if (p.latitude !== null && p.longitude !== null) db.prepare('INSERT INTO property_locations(property_id,latitude,longitude) VALUES(?,?,?)').run(id, p.latitude, p.longitude); res.json({ success: true }); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/admin/properties/:id/images/:imageId', adminOnly, (req, res) => { const image = db.prepare('SELECT image_path FROM property_images WHERE id=? AND property_id=?').get(Number(req.params.imageId), Number(req.params.id)); if (!image) return res.status(404).json({ error: 'Property image not found.' }); db.prepare('DELETE FROM property_images WHERE id=?').run(Number(req.params.imageId)); const file = path.join(publicDir, image.image_path.replace(/^\//, '')); if (fs.existsSync(file)) fs.unlink(file, () => { }); res.json({ success: true }); });
app.delete('/api/admin/properties/:id', adminOnly, (req, res) => { const id = Number(req.params.id); const imgs = db.prepare('SELECT image_path FROM property_images WHERE property_id=?').all(id); const info = db.prepare('DELETE FROM properties WHERE id=?').run(id); imgs.forEach(x => { const f = path.join(publicDir, x.image_path.replace(/^\//, '')); fs.existsSync(f) && fs.unlink(f, () => { }); }); info.changes ? res.json({ success: true }) : res.status(404).json({ error: 'Property not found.' }); });
app.patch('/api/admin/properties/:id/status', adminOnly, (req, res) => { if (!['Available', 'Under Review', 'Reserved', 'Sold'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid status.' }); const r = db.prepare('UPDATE properties SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.body.status, Number(req.params.id)); r.changes ? res.json({ success: true }) : res.status(404).json({ error: 'Property not found.' }); });
app.get('/api/admin/enquiries', adminOnly, (req, res) => { const q = `%${cleanText(req.query.q, 100)}%`; const status = cleanText(req.query.status, 30); const allowed = ['New', 'Contacted', 'Follow-up', 'Completed']; const statusSql = allowed.includes(status) ? ' AND e.status=?' : ''; const args = [q, q, q, q, q]; if (statusSql) args.push(status); const rows = db.prepare(`SELECT e.*,c.name,c.phone,c.email,c.address,p.title property_title FROM enquiries e JOIN customers c ON c.id=e.customer_id LEFT JOIN properties p ON p.id=e.property_id WHERE (c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR e.enquiry_code LIKE ? OR p.title LIKE ?)${statusSql} ORDER BY e.created_at DESC`).all(...args); res.json({ enquiries: rows }); });
app.patch('/api/admin/enquiries/:id', adminOnly, (req, res) => { const id = Number(req.params.id); if (req.body.status !== undefined && !['New', 'Contacted', 'Follow-up', 'Completed'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid enquiry status.' }); if (req.body.admin_notes !== undefined) { db.prepare('UPDATE enquiries SET admin_notes=? WHERE id=?').run(cleanText(req.body.admin_notes, 3000), id); } if (req.body.status !== undefined) db.prepare('UPDATE enquiries SET status=? WHERE id=?').run(req.body.status, id); const row = db.prepare('SELECT id FROM enquiries WHERE id=?').get(id); row ? res.json({ success: true }) : res.status(404).json({ error: 'Enquiry not found.' }); });
app.delete('/api/admin/enquiries/:id', adminOnly, (req, res) => { const r = db.prepare('DELETE FROM enquiries WHERE id=?').run(Number(req.params.id)); r.changes ? res.json({ success: true }) : res.status(404).json({ error: 'Enquiry not found.' }); });
app.get('/api/admin/customers.csv', adminOnly, (req, res) => { const rows = db.prepare(`SELECT e.enquiry_code,c.name,c.phone,c.email,c.address,p.title property,e.property_id,e.budget,e.preferred_location,e.requirements,e.message,e.status,e.created_at FROM enquiries e JOIN customers c ON c.id=e.customer_id LEFT JOIN properties p ON p.id=e.property_id ORDER BY e.created_at DESC`).all(); const fields = Object.keys(rows[0] || { enquiry_code: '', name: '', phone: '', email: '', address: '', property: '', property_id: '', budget: '', preferred_location: '', requirements: '', message: '', status: '', created_at: '' }); const quote = v => `"${String(v ?? '').replace(/"/g, '""')}"`; res.type('text/csv').attachment('dream-estate-enquiries.csv').send([fields.join(','), ...rows.map(r => fields.map(k => quote(r[k])).join(','))].join('\r\n')); });
function xmlEscape(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
function makeXlsx(rows) {
  const zlib = require('zlib');
  const columns = ['enquiry_code', 'name', 'phone', 'email', 'address', 'property', 'property_id', 'budget', 'preferred_location', 'requirements', 'message', 'status', 'admin_notes', 'created_at'];
  const headers = ['Enquiry ID', 'Customer name', 'Phone', 'Email', 'Address', 'Property', 'Property ID', 'Budget (INR)', 'Preferred location', 'Requirements', 'Message', 'Status', 'Admin notes', 'Submitted at'];
  const all = [headers, ...rows.map(r => columns.map(k => r[k] ?? ''))];
  const colName = n => { let s = ''; for (; n; n = Math.floor((n - 1) / 26))s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
  const sheetRows = all.map((row, ri) => `<row r="${ri + 1}">${row.map((v, ci) => { const ref = colName(ci + 1) + (ri + 1); if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`; return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`; }).join('')}</row>`).join('');
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Enquiries" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${sheetRows}</sheetData></worksheet>`
  };
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++)c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); return c >>> 0; });
  const crc32 = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const locals = [], centrals = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) { const nb = Buffer.from(name), raw = Buffer.from(content), data = zlib.deflateRawSync(raw), crc = crc32(raw); const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nb.length, 26); locals.push(lh, nb, data); const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(offset, 42); centrals.push(ch, nb); offset += lh.length + nb.length + data.length; }
  const central = Buffer.concat(centrals), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16); return Buffer.concat([...locals, central, end]);
}
app.get('/api/admin/customers.xlsx', adminOnly, (req, res) => { const rows = db.prepare(`SELECT e.enquiry_code,c.name,c.phone,c.email,c.address,p.title property,e.property_id,e.budget,e.preferred_location,e.requirements,e.message,e.status,e.admin_notes,e.created_at FROM enquiries e JOIN customers c ON c.id=e.customer_id LEFT JOIN properties p ON p.id=e.property_id ORDER BY e.created_at DESC`).all(); res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment('dream-estate-enquiries.xlsx').send(makeXlsx(rows)); });
app.get('/api/admin/customers.pdf', adminOnly, (req, res) => { const rows = db.prepare(`SELECT e.enquiry_code,c.name,c.phone,c.email,c.address,p.title property_title,e.property_id,e.budget,e.preferred_location,e.requirements,e.message,e.status,e.created_at FROM enquiries e JOIN customers c ON c.id=e.customer_id LEFT JOIN properties p ON p.id=e.property_id ORDER BY e.created_at DESC`).all(); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'attachment; filename="dream-estate-enquiries-report.pdf"'); const doc = new PDFDocument({ margin: 42, size: 'A4', bufferPages: true }); doc.pipe(res); doc.fontSize(20).fillColor('#123b35').text('DREAM ESTATE'); doc.moveDown(.2).fontSize(10).fillColor('#66736f').text(`Customer enquiry report · Generated ${new Date().toLocaleString('en-IN')}`); doc.moveDown(); if (!rows.length) doc.text('No customer enquiries have been received.'); for (const [i, r] of rows.entries()) { if (doc.y > 690) doc.addPage(); doc.fontSize(12).fillColor('#123b35').text(`${i + 1}. ${r.enquiry_code} · ${r.name}`); doc.moveDown(.2).fontSize(9).fillColor('#344b45').text(`Phone: ${r.phone} | Email: ${r.email}`); doc.text(`Address: ${r.address}`); doc.text(`Property: ${r.property_title || 'Not selected'} | Property ID: ${r.property_id || '—'}`); doc.text(`Budget: ${r.budget ? `₹${Number(r.budget).toLocaleString('en-IN')}` : 'Not specified'} | Status: ${r.status}`); doc.text(`Preferred location: ${r.preferred_location || 'Not specified'}`); doc.text(`Requirements: ${r.requirements || 'Not specified'}`); doc.text(`Message: ${r.message || 'Not specified'}`); doc.text(`Submitted: ${r.created_at}`); doc.moveDown(.5).strokeColor('#d6e2dc').moveTo(42, doc.y).lineTo(553, doc.y).stroke().moveDown(.5); } const range = doc.bufferedPageRange(); for (let i = range.start; i < range.start + range.count; i++) { doc.switchToPage(i); doc.fontSize(8).fillColor('#82908a').text(`Page ${i + 1} of ${range.count}`, 42, doc.page.height - 28, { align: 'center', width: 511 }); } doc.end(); });
app.get('/api/admin/enquiries/:id.pdf', adminOnly, (req, res) => { const row = db.prepare(`SELECT e.*,c.name,c.phone,c.email,c.address,p.title property_title FROM enquiries e JOIN customers c ON c.id=e.customer_id LEFT JOIN properties p ON p.id=e.property_id WHERE e.id=?`).get(Number(req.params.id)); if (!row) return res.status(404).json({ error: 'Enquiry not found.' }); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${row.enquiry_code}.pdf"`); const doc = new PDFDocument({ margin: 52 }); doc.pipe(res); doc.fontSize(22).fillColor('#123b35').text('DREAM ESTATE'); doc.moveDown(.3).fontSize(10).fillColor('#66736f').text('CUSTOMER PROPERTY ENQUIRY REPORT'); doc.moveDown().strokeColor('#d6e2dc').moveTo(52, doc.y).lineTo(543, doc.y).stroke(); doc.moveDown(); const entries = [['Enquiry ID', row.enquiry_code], ['Customer name', row.name], ['Phone', row.phone], ['Email', row.email], ['Address', row.address], ['Property', row.property_title || 'Not selected'], ['Property ID', row.property_id || 'Not selected'], ['Budget', row.budget ? `₹${Number(row.budget).toLocaleString('en-IN')}` : 'Not specified'], ['Preferred location', row.preferred_location || 'Not specified'], ['Requirements', row.requirements || 'Not specified'], ['Message', row.message || 'Not specified'], ['Enquiry status', row.status], ['Date', row.created_at]]; for (const [k, v] of entries) { doc.font('Helvetica-Bold').fontSize(10).fillColor('#243b35').text(`${k}:`, { continued: true, width: 125 }); doc.font('Helvetica').fillColor('#344b45').text(String(v)); doc.moveDown(.55); } doc.moveDown().fontSize(8).fillColor('#82908a').text('Generated from Dream Estate property management system.'); doc.end(); });
app.get('/admin', (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
app.use((err, req, res, next) => { console.error(err); res.status(400).json({ error: err.message || 'Request failed.' }); });
app.listen(PORT, () => console.log(`Dream Estate running at http://localhost:${PORT}\nAdmin: http://localhost:${PORT}/admin`));
