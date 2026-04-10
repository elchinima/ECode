# ECode

<p align="center">
  <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&pause=900&color=00B8A9&center=true&vCenter=true&width=650&lines=Generate+QR+codes+in+seconds;Scan+and+track+events+from+camera;Clean+frontend+%2B+SQL-ready+backend+scripts" alt="Typing animation" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Frontend-HTML%2FCSS%2FJS-00B8A9?style=for-the-badge" alt="Frontend" />
  <img src="https://img.shields.io/badge/Database-SQL%20Server%20%2F%20Supabase-1E3A8A?style=for-the-badge" alt="Database" />
  <img src="https://img.shields.io/badge/Status-Active-success?style=for-the-badge" alt="Status" />
</p>

ECode is a minimalist web app for creating and scanning QR codes.
It combines a browser frontend, SQL scripts, and integration with a REST API backend.

## 🚀 What You Get

- 🔐 Login and registration by email or phone
- 💾 Remember-me sessions in `localStorage`
- ⚡ Fast QR generation with compact UID payloads
- 📷 Camera scanning via `jsQR`
- 🧾 History of generated codes
- 🖼️ Download QR as PNG
- 📋 Copy QR ID to clipboard
- 🗂️ Up to 3 custom categories per user
- ⏱️ Cooldown protection for create/view/delete actions
- ✅ Confirmation modals for destructive operations
- 📈 Scan event tracking + scan counter
- 📱 Responsive single-page interface (Create / Scan tabs)

## 🛠️ Tech Stack

- `index.html` (HTML5)
- `Assets/CSSs/index.css` (CSS3)
- `Assets/Scripts/index.js` (Vanilla JavaScript)
- Libraries:
  - `qrcodejs` for QR rendering
  - `jsQR` for QR decoding
- REST API backend (configured in frontend)
- SQL scripts for SQL Server and Supabase/PostgreSQL (RLS)

## 📁 Project Structure

```text
ECode/
├─ index.html
├─ Assets/
│  ├─ CSSs/
│  │  └─ index.css
│  └─ Scripts/
│     ├─ index.js
│     └─ jsQR.min.js
└─ Database/
   ├─ ECodeDB.sql
   └─ SupabaseRLS.sql
```

## ⚙️ How It Works

### QR Format

Generated payload format:

```text
EC-YYYYMMDDHHMM-USERCODE-QRID
```

Example:

```text
EC-202604051530-0000123-AB12CD3
```

- `YYYYMMDDHHMM` -> creation timestamp
- `USERCODE` -> 7-digit code derived from user ID
- `QRID` -> random 7-char alphanumeric suffix

### Frontend Flow

1. User signs in or creates an account.
2. User fills the form and generates a QR code.
3. Frontend sends data to backend and updates history.
4. User scans QR with camera.
5. Scan events are posted for counting/analytics.

Endpoints used in frontend:

- `POST /api/Auth/login`
- `POST /api/Auth/register`
- `POST /api/QrCodes`
- `GET /api/QrCodes/user/{userId}`
- `DELETE /api/QrCodes/{uid}/permanent?userId={userId}`
- `DELETE /api/QrCodes/category/by-name/permanent?userId={userId}&categoryName={name}`
- `POST /api/Scan`
- `GET /api/Scan/count/{userId}`

## 🗄️ Database

### `Database/ECodeDB.sql` (SQL Server)

Creates:

- `users`
- `categories`
- `qr_codes`
- `qr_scan_events`

Includes:

- constraints and indexes
- computed columns (normalized contact and user code)
- UID format checks
- update trigger(s)
- seed data for system categories

### `Database/SupabaseRLS.sql` (PostgreSQL / Supabase)

- Enables RLS for `users`, `categories`, `qr_codes`, `qr_scan_events`
- Adds service-role-only policies for backend access
- Includes optional diagnostics query

## ▶️ Run Locally

Frontend is static, so any static server is enough.

## 🔧 Configuration

If you use your own backend, update `API_URL` in:

- `Assets/Scripts/index.js`

## 📝 Notes

- Camera scan needs browser camera permission.
- Use HTTPS in production for secure camera access.
- Some UI strings are mixed-language and can be fully localized.

## 🔒 Security

- Never expose service-role credentials in frontend code.
- Keep auth and privileged DB operations on backend only.
- Use HTTPS in production to protect auth and camera flows.

## 🧭 Roadmap

- Better SEO with multilingual routing and `hreflang`
- History export to CSV
- Role-based dashboards and analytics

## 📄 License

No license file is included yet.
Add `LICENSE` (for example MIT) before distribution.
