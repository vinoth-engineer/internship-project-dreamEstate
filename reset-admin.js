
const db = require('./database/db');
const bcrypt = require('bcryptjs');

const username = 'admin';
const newPassword = 'vinoth';

const admin = db.prepare(
  'SELECT id FROM admins ORDER BY id LIMIT 1'
).get();

const hash = bcrypt.hashSync(newPassword, 12);

if (admin) {
  db.prepare(
    'UPDATE admins SET username = ?, password_hash = ? WHERE id = ?'
  ).run(username, hash, admin.id);
} else {
  db.prepare(
    'INSERT INTO admins (username, password_hash) VALUES (?, ?)'
  ).run(username, hash);
}

console.log('Admin password reset successfully!');
console.log('Username:', username);

db.close();
