# AI-Powered Loan Risk & Recommendation System

A Sri Lankan-banking-context web application that classifies loan applicants
into **Low / Medium / High** risk, produces loan recommendations, and
surfaces currency exchange-rate analytics and an FX exchange workflow for
customers, staff, and admins. Available in English, Sinhala, and Tamil.

This is a monorepo of **four independently-runnable modules**:

| Module | Path | Runtime | Port | Purpose |
|---|---|---|---|---|
| Frontend SPA | [`finance-frontend/`](finance-frontend/) | React 19 / Vite | 5173 | Customer/staff/admin web UI |
| API Gateway | [`finance-backend/`](finance-backend/) | Node / Express 5 | 5000 | Auth, business logic, MySQL, the only thing the browser talks to |
| Loan-risk ML service | [`loan-risk-model/`](loan-risk-model/) | Python / FastAPI | 8000 | Loan default risk inference (XGBoost) |
| Currency ML service | [`currency-forecast-model/`](currency-forecast-model/) | Python / FastAPI | 8100 | Exchange-rate forecast/trend/volatility/anomaly inference (LSTM, XGBoost, GARCH, Isolation Forest) |

Plus MySQL 8 (`:3306`), managed by the backend's migrations.

For the full system design (containers, data flow, data model, ML models,
integration contracts, security), see **[ARCHITECTURE.md](ARCHITECTURE.md)**.

The browser only ever calls the API Gateway — never either Python service
directly (see [ARCHITECTURE.md §2](ARCHITECTURE.md#2-architectural-principles)).

---

## Prerequisites

- Node.js 18+
- Python 3.10 or 3.11 (both Python services use the same version range)
- MySQL 8+ running locally (or reachable)
- A **trained loan-risk model** in `loan-risk-model/model_artifacts/` — generate
  the dataset and train it yourself (see [Loan-risk ML service setup](#3-loan-risk-ml-service-8000) below)
  if artifacts don't already exist.
- **Trained currency-forecast models** in `currency-forecast-model/models/` —
  training now runs fully locally as standalone `.py` scripts under
  `currency-forecast-model/training/` (no Kaggle round-trip needed); see
  [Currency-forecast ML service setup](#4-currency-forecast-ml-service-8100).

Each module keeps its own dependencies (`node_modules/`, Python `venv/`) —
install them per-module as shown below, not from the repo root.

> **Windows users:** every command block below shows Linux/macOS (bash) and
> Windows equivalents side by side. The Windows commands assume **PowerShell**;
> where `cmd.exe` differs, it's called out. `&&` chaining requires PowerShell 7+
> or `cmd.exe` — on Windows PowerShell 5.1, run each command on its own line
> instead.

---

## Configuring `finance-backend/.env`

Every server-side secret lives in **one** file: `finance-backend/.env`. It is
gitignored and must never be committed. Start from the template:

Linux/macOS:

```bash
cd finance-backend
cp .env.example .env
```

Windows (PowerShell or cmd.exe):

```powershell
cd finance-backend
copy .env.example .env
```

The template ships with working defaults for everything **except the three
token secrets, which are intentionally blank** — the app will not start
without them.

### Step 1 — generate the token secrets (required)

`ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET` and `RESET_TOKEN_SECRET` are the
HMAC keys used to sign JWTs and password-reset tokens. They are *not* passwords
you invent — they must be long, random, and **different from each other**.
Reusing one value across all three means a leaked access token could be
replayed as a refresh token or a password-reset token.

Generate three independent values and paste them in. This just prints to the
console (no file is touched), so it can be run from anywhere Node is
installed — e.g. from `finance-backend/`:

```bash
# Run three times, once per secret (64 hex chars = 256 bits of entropy)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Or write all three straight into `.env` in one go, from `finance-backend/`:

Linux (macOS: replace `sed -i -E` with `sed -i '' -E`):

```bash
for k in ACCESS_TOKEN_SECRET REFRESH_TOKEN_SECRET RESET_TOKEN_SECRET; do
  v=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -i -E "s|^$k=.*|$k=$v|" .env
done
grep -E '^(ACCESS|REFRESH|RESET)_TOKEN_SECRET=' .env    # confirm all three differ
```

Windows (PowerShell):

```powershell
foreach ($k in "ACCESS_TOKEN_SECRET","REFRESH_TOKEN_SECRET","RESET_TOKEN_SECRET") {
  $v = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  (Get-Content .env) -replace "^$k=.*", "$k=$v" | Set-Content .env
}
Select-String -Path .env -Pattern '^(ACCESS|REFRESH|RESET)_TOKEN_SECRET='  # confirm all three differ
```

`openssl rand -hex 32` works equally well if you'd rather not use Node (available
on Windows via Git Bash or WSL).

**Do not** use a memorable phrase, the same value in two fields, or the value
from someone else's machine. Changing a secret later is safe but invalidates
every issued token — all users are logged out and pending reset links stop
working.

### Step 2 — point at your database (required)

```ini
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your-mysql-password
DB_NAME=ai_loan
```

Create the schema (`CREATE DATABASE ai_loan;`) before running `npm run migrate`.

### Step 3 — optional keys (safe to leave blank)

| Variable | Blank behaviour | Get one |
|---|---|---|
| `GEMINI_API_KEY` | Risk explanations fall back to a deterministic template — assessment still succeeds | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) (free) |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Forgot-password OTPs are printed to the server console instead of emailed | Any SMTP provider — see below for Gmail |
| `FX_QUOTE_SECRET` | Falls back to `ACCESS_TOKEN_SECRET` | Generate as in Step 1 — set it only if FX quote tokens should rotate independently of login tokens |

No other external account is needed. The live FX rate feed
(`open.er-api.com`) and the Fed H.10 data source (FRED) are both **free and
keyless**.

#### Sending real OTP emails via Gmail SMTP

`finance-backend/src/utils/mailer.js` builds a standard `nodemailer` SMTP
transport whenever `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` are all set. Gmail
works with it directly, but **your normal Google password will not work** —
Gmail dropped plain-password SMTP login. You need an **app password**
instead, generated from your Google **Account** settings (this is not the
Google Cloud Console — no GCP project needed).

1. **Turn on 2-Step Verification**, if it isn't already:
   [myaccount.google.com/security](https://myaccount.google.com/security) →
   "2-Step Verification". App passwords don't exist as an option until this
   is on.
2. **Generate an app password**:
   [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
   → name it (e.g. `finance-app-smtp`) → **Create**. Google shows the
   16-character password once — copy it now, it can't be viewed again (you
   can revoke and regenerate if you lose it). If the page 404s or says it's
   unavailable, 2-Step Verification isn't fully enabled yet.
3. **Fill in `finance-backend/.env`**:
   ```ini
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=youraddress@gmail.com
   SMTP_PASS=the16charapppassword
   SMTP_FROM=youraddress@gmail.com
   ```
   - `SMTP_USER` is your full Gmail address; `SMTP_PASS` is the app password
     from step 2 (with or without the spaces Google shows it with — both work).
   - `SMTP_FROM` can only differ from `SMTP_USER` if it's an alias on the same
     Google account, otherwise Gmail rejects or rewrites it.
   - Port `587` (STARTTLS) matches `mailer.js`'s default; don't change it
     unless you also switch to `465` deliberately (`secure` is derived from
     the port automatically).
4. **Restart the backend**, then trigger a real forgot-password request and
   check spam on the first send.

**Before relying on this for anything beyond local dev/demo:** a personal
Gmail account has a low daily send cap (~500/day) and Google can throttle or
flag automated mail from it. Fine for a viva; not a substitute for a real
transactional-email provider in production. Leaving `SMTP_*` blank is not a
lesser option — the console-logged OTP path is simpler to demo and has zero
external dependency to explain if something breaks.

### Full variable reference

`.env.example` documents every variable inline, including the FX-workflow
tuning values (quote TTL, review SLA, board staleness) and the rate-feed poll
interval:

```bash
cat finance-backend/.env.example          # Windows: type finance-backend\.env.example
```

### Ports & cross-service wiring

| Var | Where | Value (local dev) |
|---|---|---|
| `PORT` | `finance-backend/.env` | `5000` |
| `MODEL_URL` | `finance-backend/.env` | `http://localhost:8000` (loan-risk service) |
| `CURRENCY_MODEL_URL` | `finance-backend/.env` | `http://localhost:8100` (currency service) |
| `DB_HOST` / `DB_PORT` / `DB_NAME` | `finance-backend/.env` | `localhost` / `3306` / `ai_loan` |
| `CURRENCY_RATE_PROVIDER_URL` | `finance-backend/.env` | `https://open.er-api.com/v6/latest/USD` (default, no key) |
| — | `finance-frontend/src/api/axios.js` | hard-coded `http://localhost:5000/api` (no env var yet) |

Neither Python service reads a `.env` file — both are configured by CLI flags
(host/port) and read their model artifacts from disk.

### Security notes

- `.env` is gitignored. If you ever commit one by accident, **rotate every
  value in it** — git history keeps the old contents even after deletion.
- Secrets are read only by the Node gateway. The browser never receives them,
  and neither Python service is given any (P3, ARCHITECTURE.md §2).
- The refresh token is stored in an `httpOnly`, `sameSite` cookie, so it is not
  readable from JavaScript; the access token is held in memory only.
- Use different secrets per environment. A development secret that leaks must
  never be able to mint valid production tokens.

---

## Running all four services (local dev)

MySQL must be up and migrated before the gateway starts; the two Python
services can start in any order, before or after the gateway (the gateway
only calls them on demand, per-request).

> Only the gateway and frontend are required for the non-ML parts of the app
> (auth, applications, admin/staff management) to work. Skip the loan-risk
> service if you don't need `/api/loans/assess`, `/api/loans/manual-assess`,
> or the Eligibility checker's live assessment. Skip the currency service if
> you don't need `/api/currency/*` or the Currency tabs/pages — those calls
> fail with a `502`/`503` (not a crash) if the currency service isn't running.

### 1. Database (one-time, or after pulling new migrations)

`finance-backend/.env` must already be configured — see "Configuring
`finance-backend/.env`" above — before running `npm run migrate`; the
gateway process this connects through won't start without the token
secrets filled in.

```bash
cd finance-backend
npm install             # first time only
npm run migrate
```

### 2. API Gateway — `:5000`

```bash
cd finance-backend
npm run dev
```

On first boot it seeds a default admin (`admin@aura.com` / `Admin@123` —
change before any real deployment).

### 3. Loan-risk ML service — `:8000`

First time only, from `loan-risk-model/`:

Linux/macOS:

```bash
cd loan-risk-model
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python -m src.data_generator    # generates data/sri_lanka_credit_risk.csv
python -m src.model_utils       # trains + saves model_artifacts/
```

Windows (PowerShell):

```powershell
cd loan-risk-model
python -m venv venv
venv\Scripts\Activate.ps1        # cmd.exe: venv\Scripts\activate.bat
pip install -r requirements.txt
python -m src.data_generator    # generates data/sri_lanka_credit_risk.csv
python -m src.model_utils       # trains + saves model_artifacts/
```

Then, to run the service:

Linux/macOS:

```bash
cd loan-risk-model
source venv/bin/activate
python -m api.main
# or, with auto-reload: uvicorn api.main:app --reload --host 127.0.0.1 --port 8000
```

Windows (PowerShell):

```powershell
cd loan-risk-model
venv\Scripts\Activate.ps1
python -m api.main
# or, with auto-reload: uvicorn api.main:app --reload --host 127.0.0.1 --port 8000
```

Interactive docs: `http://127.0.0.1:8000/docs`.

### 4. Currency-forecast ML service — `:8100`

First time only, from `currency-forecast-model/`:

Linux/macOS:

```bash
cd currency-forecast-model
python3 -m venv venv
venv/bin/pip install -r requirements.txt
venv/bin/python data/prepare_data.py    # if data/processed/ is empty
```

Windows (PowerShell):

```powershell
cd currency-forecast-model
python -m venv venv
venv\Scripts\pip install -r requirements.txt
venv\Scripts\python data\prepare_data.py    # if data\processed\ is empty
```

Trained model artifacts (LSTM/XGBoost/GARCH/Isolation Forest) must exist
under `currency-forecast-model/models/` before starting. The repo ships with
a trained set already committed, so this step is usually a no-op — but
retraining, if you ever need it, is fully local now (still from
`currency-forecast-model/`, with the venv created above already active):

Linux/macOS:

```bash
venv/bin/python -m src.data_fetcher                          # refresh data/raw/ from FRED (optional)
venv/bin/python data/prepare_data.py --raw-path data/raw/exchange_rates_refreshed.csv
venv/bin/python training/train_garch_volatility.py
venv/bin/python training/train_isolation_forest.py
venv/bin/python training/train_xgboost_trend_v2.py
venv/bin/python training/train_lstm_forecast_v2.py            # slowest step, CPU-only is fine
```

Windows (PowerShell):

```powershell
venv\Scripts\python -m src.data_fetcher                                 # refresh data\raw\ from FRED (optional)
venv\Scripts\python data\prepare_data.py --raw-path data\raw\exchange_rates_refreshed.csv
venv\Scripts\python training\train_garch_volatility.py
venv\Scripts\python training\train_isolation_forest.py
venv\Scripts\python training\train_xgboost_trend_v2.py
venv\Scripts\python training\train_lstm_forecast_v2.py                  # slowest step, CPU-only is fine
```

Each trainer accepts `--data-dir`/`--output-dir`/`--train-end`/`--val-end`
so a retrain can be built side-by-side without overwriting the committed
artifacts until you're ready to swap them in — see the module docstring at
the top of each script for the full flag list. See
[ARCHITECTURE.md §8](ARCHITECTURE.md#8-currency-forecast-models-currency-forecast-model)
for what each model does and why.

Linux/macOS:

```bash
cd currency-forecast-model
venv/bin/python -m api.main
# or, with auto-reload: venv/bin/uvicorn api.main:app --reload --host 127.0.0.1 --port 8100
```

Windows (PowerShell):

```powershell
cd currency-forecast-model
venv\Scripts\python -m api.main
# or, with auto-reload: venv\Scripts\uvicorn api.main:app --reload --host 127.0.0.1 --port 8100
```

Interactive docs: `http://127.0.0.1:8100/docs`.

### 5. Frontend — `:5173`

```bash
cd finance-frontend
npm install   # first time only
npm run dev
```

Open `http://localhost:5173`. The API base URL is hard-coded in
`finance-frontend/src/api/axios.js` (`http://localhost:5000/api`) — update it
there if you change the backend host.

---

## Default login

| Role | Email | Password |
|---|---|---|
| Admin | `admin@aura.com` | `Admin@123` |

Auto-seeded by the backend on first startup. There's no seeded customer or
staff account — sign up via `/register` for a customer, or have an admin
create a staff account from Admin → Staff.

---


## Running tests

```bash
cd finance-backend && npm test    # plain Node scripts under src/services/__tests__/
cd finance-frontend && npm run lint
```

For the ML services, reproduce the loan-risk evaluation report by re-running
`python -m src.model_utils` from `loan-risk-model/` (with its venv activated —
see [Loan-risk ML service setup](#3-loan-risk-ml-service-8000)); reproduce the
currency model evaluation numbers with the scripts under
`currency-forecast-model/training/`, run from `currency-forecast-model/` with
its own venv activated (see
[ARCHITECTURE.md §6.4](ARCHITECTURE.md#64-currency-service)).
