# ECode

ECode is a minimalist web application for generating and scanning QR codes.
It includes a browser-based frontend, SQL database scripts, and integration points for a remote REST API.

## Features

- User login/registration by email or phone
- Remember-me session persistence in `localStorage`
- QR code generation with compact UID payloads
- QR code scanning from camera using `jsQR`
- History list of generated codes
- QR download as PNG
- Copy generated QR ID to clipboard
- Create and manage up to 3 custom categories per user
- Operation cooldown protection for create/view/delete actions
- Confirmation modals for destructive actions
- Scan event tracking and scan counter
- Responsive, single-page UI with tabs (Create / Scan)

## Tech Stack

- HTML5 (`index.html`)
- CSS3 (`Assets/CSSs/index.css`)
- Vanilla JavaScript (`Assets/Scripts/index.js`)
- Third-party libraries:
  - `qrcodejs` (QR rendering)
  - `jsQR` (QR decoding)
- REST API backend (configured in frontend)
- SQL scripts for SQL Server and Supabase/PostgreSQL RLS

## Project Structure

```text
ECode/
+- index.html
+- Assets/
  +- CSSs/
    L- index.css
  L- Scripts/
     +- index.js
     L- jsQR.min.js
L- Database/
   +- ECodeDB.sql
   L- SupabaseRLS.sql
```

## How It Works

### QR Format

Generated QR payloads are compact and based on an internal UID pattern:

```text
EC-YYYYMMDDHHMM-USERCODE-QRID
```

Example:

```text
EC-202604051530-0000123-AB12CD3
```

- `YYYYMMDDHHMM`: creation timestamp
- `USERCODE`: 7-digit user code derived from user ID
- `QRID`: random 7-character alphanumeric suffix

### Frontend Flow

1. User signs in or registers.
2. User fills QR form and generates a QR code.
3. Frontend posts data to backend and refreshes history.
4. User can scan QR codes via camera.
5. Scan events are posted to backend for analytics/counting.

## API Integration

The frontend points to:

```js
const API_URL = 'https://ecode-api-oc7z.onrender.com';
```

Used endpoints (from frontend code):

- `POST /api/Auth/login`
- `POST /api/Auth/register`
- `POST /api/QrCodes`
- `GET /api/QrCodes/user/{userId}`
- `DELETE /api/QrCodes/{uid}/permanent?userId={userId}`
- `DELETE /api/QrCodes/category/by-name/permanent?userId={userId}&categoryName={name}`
- `POST /api/Scan`
- `GET /api/Scan/count/{userId}`

## Database

### `Database/ECodeDB.sql` (SQL Server)

Creates and configures:

- `users`
- `categories`
- `qr_codes`
- `qr_scan_events`

Includes:

- constraints and indexes
- computed columns (including normalized contact and user code)
- UID format checks
- update trigger(s)
- seed data for system categories

### `Database/SupabaseRLS.sql` (PostgreSQL / Supabase)

- Enables RLS on `users`, `categories`, `qr_codes`, `qr_scan_events`
- Adds service-role-only policies for backend access
- Provides optional diagnostics query

## Local Run

This project is static on the frontend side.
You can run it with any static server.

## Configuration

If you have your own backend, update `API_URL` in:

- `Assets/Scripts/index.js`

## Notes

- Camera scan requires browser camera permission.
- For secure camera access in production, use HTTPS.
- Some UI strings are currently mixed-language and can be fully localized if needed.

## Security Considerations

- Do not expose service-role credentials in frontend code.
- Keep authentication and privileged DB access on the backend only.
- Use HTTPS in production to protect auth and camera-related flows.

## Roadmap Ideas

- Full i18n (EN/AZ/RU) for all UI strings
- Better SEO with multilingual routing and `hreflang`
- Export history to CSV
- Role-based dashboards and analytics

## License

No license file is included in this repository yet.
Add a `LICENSE` file (for example MIT) if you plan to distribute it.
