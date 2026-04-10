# HearthNet
A sleek, privacy-first personal finance dashboard designed with a warm, glassmorphism "aged ledger" aesthetic.

![HearthNet Dashboard](https://raw.githubusercontent.com/xinggao/hearthnet/main/frontend/public/demo.gif)

## Overview
HearthNet is a full-stack personal finance application built to replace massive, chaotic Excel spreadsheets. It parses your bank and credit card statements locally on your machine and generates beautiful, tactile visual analytics of your spending, income, and overall cash flow.

It features:
- **Zero-Config CSV/Excel parsing:** Drag and drop exports from Chase, Amex, Discover, and more.
- **AI-Powered Scanned PDF Parsing (Optional):** Employs Anthropic's Claude to cleanly read messy, scanned paper bank statements if standard raw text extraction fails.
- **Aesthetic First:** A fully custom TailwindCSS design system rooted in warm parchment and olive tones, delivering an authentic "aged ledger" feel with dark mode support.
- **Total Privacy:** The entire application runs natively on your machine using a local SQLite database. Financial data never touches a public cloud.

## Tech Stack
- **Frontend:** React 18, Vite, TailwindCSS (Vanilla UI with strict semantic tokens), Recharts
- **Backend:** FastAPI (Python), SQLite, SQLAlchemy
- **Data Extractor:** Pandas, Pdfplumber, Anthropic Python SDK (optional)

## What Works Without an API Key?

| Feature | No API Key | With API Key |
|---|:---:|:---:|
| CSV uploads (Chase, Amex, Discover, Citi, PNC, etc.) | ✅ | ✅ |
| Excel (.xlsx) uploads | ✅ | ✅ |
| Digital PDF statements | ✅ | ✅ |
| Full dashboard & analytics | ✅ | ✅ |
| Dark mode | ✅ | ✅ |
| Scanned/image PDF parsing | ❌ | ✅ |
| Screenshot (.png/.jpg) parsing | ❌ | ✅ |

> **Most users will never need an API key.** Every major bank exports CSV or digital PDF, both of which parse perfectly without AI.

## Prerequisites

| Requirement | Version | Required? |
|---|---|---|
| **Node.js** | v18+ | ✅ Required to run |
| **Python** | v3.10+ | ✅ Required to run |
| **Anthropic API Key** | — | ❌ Optional |

> **New to development?** Don't worry — the startup script will detect what's missing and walk you through installing it. Just follow the Quickstart below.

## Quickstart

### 1. Clone the Repository
```bash
git clone https://github.com/YOUR_USERNAME/hearthnet.git
cd hearthnet
```

### 2. Run the App
```bash
./start.sh
```

That's it! The startup script will:
1. **Check for Node.js** — if missing, offer to install via Homebrew (macOS) or show install links
2. **Check for Python 3** — same as above
3. **Create your `.env` file** — auto-copied from the template
4. **Install all dependencies** — Python packages & frontend modules
5. **Launch both servers** — backend on `:8000`, frontend on `:5173`
6. **Open your browser** — the dashboard loads automatically

### 3. Enable AI Parsing (Optional)
If you want to upload scanned paper statements or screenshot images:

1. Get an API key at [console.anthropic.com](https://console.anthropic.com/)
2. Open `.env` and add your key:
   ```env
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   ```
3. Restart the app (`Ctrl+C`, then `./start.sh` again)

## Demo Data
Want to test the app without uploading your real bank statements?
1. Open the app in your browser.
2. Click **Upload Statement** in the top right.
3. Drag and drop all the dummy CSV files located in the `demo_monthly/` repository folder.
4. Enjoy real-time, dummy 20-month trend analysis!

## Troubleshooting

<details>
<summary><b>start.sh: permission denied</b></summary>

Run `chmod +x start.sh` then try again.
</details>

<details>
<summary><b>"No module named 'fastapi'" or similar Python errors</b></summary>

Delete the virtual environment and let `start.sh` recreate it:
```bash
rm -rf backend/.venv
./start.sh
```
</details>

<details>
<summary><b>Uploaded a scanned PDF and got an error</b></summary>

Scanned/image PDFs require an Anthropic API key. Either:
- Export your statement as a **CSV** from your bank's website (recommended), or
- Add an `ANTHROPIC_API_KEY` to your `.env` file
</details>

<details>
<summary><b>Port 8000 or 5173 already in use</b></summary>

Kill the existing process:
```bash
lsof -ti:8000 | xargs kill -9
lsof -ti:5173 | xargs kill -9
```
</details>

## License
**Apache 2.0 with Commons Clause**

This software is "Source-Available". You are free to view, fork, modify, and use this application for your own personal financial tracking. 

However, under the Commons Clause, **you are strictly prohibited from selling this software or hosting it as a commercial service/SaaS.**
