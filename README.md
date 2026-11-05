# Dream Estate — Full-stack real estate platform

A responsive property discovery and management website built with HTML, CSS, vanilla JavaScript, Node.js, Express and SQLite. The project intentionally contains **no maps, map widgets, satellite layers, map APIs or map keys**. Property photos and image galleries are used for visual discovery instead.

## Features

### Public website
- Responsive home, property listings, facilities, about and contact sections.
- Property cards with photos, property ID, type, location, INR price, land area and status.
- Property detail dialog with photo gallery, description, land dimensions, facing, utilities, amenities and verified facility records.
- Admin can enter verified nearby facilities in a documented line format and remove individual property photos.
- Search by keyword/location, price range and property type.
- Filter by Available, Under Review, Reserved and Sold; sort by newest, price or land area.
- Customer enquiry form with server-side validation and a stored enquiry reference.
- Optional SMTP email notification. A saved enquiry is never represented as a successfully delivered email unless SMTP reports success.

### Admin portal (`/admin`)
- Separate login with bcrypt password hashing and session-based access.
- Dashboard totals for properties, availability statuses and enquiries.
- Add, edit and delete properties; upload multiple JPEG/PNG/WebP/AVIF photos (up to 8 per request, 5 MB each).
- Change property status and manage price, land area, description and amenities.
- Search enquiries, update enquiry status, save internal admin notes and delete enquiries.
- Download enquiry data as CSV, Excel `.xlsx` or a multi-page PDF report; download an individual enquiry PDF.
- Change administrator username and password from the dashboard. Passwords must be at least 12 characters.

### Data accuracy
- The database starts empty; no fabricated properties, prices, coordinates, facilities or customer enquiries are seeded.
- A listing's water and road-access flags should only be enabled after verification by the administrator.
- Nearby facility records can be stored in the database, but the UI shows `Information unavailable` when none are recorded.
- Only upload photos you have permission to use.

## Requirements
- Node.js 20 or newer (Node.js 22 LTS recommended).
- npm.
- Windows, macOS or Linux.

SQLite is included through `better-sqlite3`; there is no separate database server to install. This project preserves the Node/SQLite architecture of the supplied codebase instead of switching to Java/MySQL.

## Install and run in VS Code (Windows)

1. Extract the ZIP file.
2. Open the extracted `dream-estate` folder in VS Code (`File → Open Folder`).
3. Open the integrated terminal (`Terminal → New Terminal`).
4. Install dependencies:

   ```powershell
   npm install
   ```

5. Create your environment file by copying `.env.example` to `.env`:

   ```powershell
   Copy-Item .env.example .env
   ```

6. Edit `.env` before the first start. Set a unique administrator username, a strong password (12+ characters), and a long random session secret. Example PowerShell command to generate a session secret:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   Paste the generated value into `SESSION_SECRET` in `.env`.

7. Start the server:

   ```powershell
   npm start
   ```

8. Open these addresses in your browser:
   - Website: `http://localhost:3000`
   - Admin: `http://localhost:3000/admin`
   - Health check: `http://localhost:3000/api/health`

For automatic restart while developing, use `npm run dev`.

## Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default `3000`) |
| `NODE_ENV` | Use `production` when deployed behind HTTPS |
| `SESSION_SECRET` | Secret used to sign login sessions; change before deployment |
| `ADMIN_USERNAME` | Initial admin username, read only when the database has no admin yet |
| `ADMIN_PASSWORD` | Initial admin password, hashed before storage; read only on first initialization |
| `ADMIN_EMAIL` | Recipient for new enquiry notifications |
| `SMTP_HOST` | SMTP server hostname; leave blank to disable email |
| `SMTP_PORT` | SMTP port (commonly `587` or `465`) |
| `SMTP_SECURE` | `true` for implicit TLS, otherwise `false` for STARTTLS configurations |
| `SMTP_USER` / `SMTP_PASS` | SMTP login credentials |
| `MAIL_FROM` | Optional sender address; defaults to `SMTP_USER` |

**Important:** the initial admin account is created on the first server start. Changing `ADMIN_USERNAME` or `ADMIN_PASSWORD` after that will not overwrite the existing account. Use the Administrator credentials form in the admin dashboard to change them, or remove the local database only if you intentionally want a fresh empty project database.

## Project structure

```text
dream-estate/
├── database/
│   └── db.js                 # SQLite schema, indexes and safe schema upgrade
├── public/
│   ├── css/style.css         # Public and admin responsive styles
│   ├── js/app.js             # Public search, property detail and enquiry flows
│   ├── js/admin.js           # Admin login, CRUD, enquiry and account UI
│   ├── uploads/              # Uploaded property images (created/used by server)
│   ├── index.html            # Public website
│   └── admin.html            # Admin portal
├── utils/email.js            # Optional SMTP notification
├── .env.example              # Environment variable template
├── .gitignore
├── package.json
├── README.md
└── server.js                 # Express app and REST API
```

## Main API routes

### Public
- `GET /api/health`
- `GET /api/properties` — optional query params: `q`, `location`, `status`, `type`, `minPrice`, `maxPrice`, `minArea`, `maxArea`, `facing`, `water=1`, `electricity=1`, `road=1`, `sort=price-asc|price-desc|area-desc`.
- `GET /api/properties/:id`
- `GET /api/stats`
- `POST /api/enquiries`

### Admin (login required)
- `GET /api/admin/session`
- `POST /api/admin/login`
- `POST /api/admin/logout`
- `PUT /api/admin/credentials`
- `GET /api/admin/overview`
- `GET /api/admin/properties`
- `POST /api/admin/properties`
- `PUT /api/admin/properties/:id`
- `DELETE /api/admin/properties/:id`
- `PATCH /api/admin/properties/:id/status`
- `GET /api/admin/enquiries?q=...`
- `PATCH /api/admin/enquiries/:id` — status and/or `admin_notes`.
- `DELETE /api/admin/enquiries/:id`
- `GET /api/admin/customers.csv`
- `GET /api/admin/customers.xlsx`
- `GET /api/admin/customers.pdf`
- `GET /api/admin/enquiries/:id.pdf`

## Database and uploads

The SQLite database is created automatically at `database/dream-estate.sqlite` on first run. Uploaded photos are stored in `public/uploads/`. Both are ignored by Git so private local records and uploaded files are not accidentally committed. Back up the database and uploads directory together.

## Security notes before deployment

- Set `NODE_ENV=production`, a unique `SESSION_SECRET`, and non-default admin credentials.
- Deploy behind HTTPS so secure session cookies are enabled.
- Keep `.env`, SQLite files, and uploaded customer data out of public source control.
- Use a persistent disk for both the SQLite database and uploaded photos. Ephemeral serverless filesystems are not suitable without external persistent storage.
- Configure SMTP only with an app-specific credential where supported.
- Review your hosting provider's backup, retention and privacy settings.

## Feature smoke test

1. Run `npm install` and `npm start`; confirm `/api/health` returns `{ "ok": true, "database": "SQLite" }`.
2. Open the public website and confirm it shows the empty-listing state without fabricated properties.
3. Log in at `/admin` with the credentials configured before the first run.
4. Add a clearly identified test listing and upload one or more permitted photos.
5. Open the public site, confirm the listing appears, open its detail gallery, then edit the listing in admin and confirm the public listing updates.
6. Submit a test enquiry; confirm a reference is shown and the enquiry appears in admin.
7. Update enquiry status and notes; download CSV, Excel and PDF exports.
8. Test admin logout and verify protected API routes return HTTP 401 when logged out.
9. Test responsive layouts at 320, 375, 425, 768, 1024, 1440 and 1920 px widths using browser developer tools.
10. Test form validation, missing images, invalid image uploads, and SMTP-disabled behaviour.

## Notes

The ZIP contains source code, not installed `node_modules` or a pre-populated database. Run `npm install` after extraction. No real-world property listing or customer record is included by default.
