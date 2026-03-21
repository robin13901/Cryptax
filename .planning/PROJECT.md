# Cryptax

## What This Is

A local web application that imports cryptocurrency transaction data from Bitget (spot trades, futures, on-chain earn/staking), stores them in a SQLite database, displays an interactive dashboard with portfolio statistics and charts, and generates a German tax report (Krypto-Steuerreport) suitable for attachment to the Einkommensteuererklärung. Built for personal use — runs locally via `npm run dev`, no cloud deployment.

## Core Value

Accurate German crypto tax calculation with FIFO-based holding period tracking, producing a Finanzamt-ready Steuerreport that covers Spot, Futures, and Earn income correctly.

## Requirements

### Validated

- ✓ React 19 SPA with Vite 8 and TypeScript 5.9 strict mode — existing
- ✓ 3-tab navigation (Dashboard, Transaktionen, Steuerreport) with pill nav and motion transitions — existing
- ✓ Glassmorphism design system with GlassSurface component and dark theme — existing
- ✓ KPI card grid layout on Dashboard tab — existing (placeholder data)

### Active

- [ ] Node.js backend with SQLite database for persistent transaction storage
- [ ] Bitget CSV parser supporting all export types (spot transactions, futures transactions, spot order history, futures order history, on-chain earn)
- [ ] Multi-year data management — import and track transactions across multiple tax years
- [ ] Historical EUR price resolution via API (Bitget API or best alternative) for all transactions
- [ ] FIFO engine for holding period calculation and cost basis tracking
- [ ] German crypto tax calculation: Spot (1-year Haltefrist, 1.000€ Freigrenze), Futures (Abgeltungssteuer 26,375%), Earn/Staking (Einkommensteuer at Zufluss, 10-year Haltefrist)
- [ ] Dashboard with KPI cards (Gesamtgewinn, Trades, steuerpflichtiger Betrag, geschätzte Steuer) and multiple Recharts visualizations (P&L over time, portfolio distribution, per-coin P&L, monthly performance, spot vs futures comparison)
- [ ] Transaction tab with CSV import (drag & drop + file picker), transaction list with filters/search/sort, and category display (Spot, Futures, Earn, Gebühren)
- [ ] Steuerreport tab with Anlage SO summary view, full trade-level detail appendix, and PDF/CSV export
- [ ] Replace Aurora background with Floating Lines from reactbits.dev

### Out of Scope

- Cloud deployment — local-only app, no hosting
- Real-time portfolio tracking / live price feeds — this is a tax tool for historical data
- Exchanges other than Bitget — only Bitget CSVs supported
- Mobile app — web-only, desktop-first (tablet-friendly via responsive design)
- User authentication / multi-user — single-user local tool
- Tailwind / UI framework — custom CSS with Glassmorphism design system

## Context

- **Data source:** Bitget CSV exports with semicolon and comma delimiters, varying column schemas per export type
- **CSV formats (2024/2025 data available):**
  - Spot transactions: `order;Date;Coin;Type;Amount;Fee;Available`
  - Futures transactions: `Order,Date,Coin,Futures,Margin Mode,Type,Amount,Fee,Wallet balance`
  - Spot order history: `Date,Type,Order Id,Trading pair,Base Asset,Quote Asset,Direction,Price,Order amount,Executed,Average Price,Trading volume,Status`
  - Futures order history: `Date,Order ID,Direction,Coin,Futures,order source,Transaction type,Price,Average Price,Order amount,Executed,Trading volume,Realized P/L,NetProfits,Status`
  - On-chain earn: `Reference,Start time,Coin,Type,Interest coin,Amount,Handling fee,Status`
- **Data volume:** ~3,400 rows across 2024 + 2025 (moderate, SQLite handles easily)
- **Price fetching:** Existing Python script (`references/get_eur_prices_bitget.py`) uses Bitget public spot history-candles API (COIN→EUR direct, or COIN→USDT * USDT→EUR fallback). Needs research for best/most accurate approach in Node.js.
- **Design reference:** Atlanta project (`C:\SAPDevelop\AtlantaTestSuiteAnalyzer\dashboard`) — same Glassmorphism visual style, pill navigation, KPI cards, Recharts
- **Color palette:** Blue #0070F2, Green #5fdc8a, Red #E50000, Orange #E9730C (dark theme)

## Constraints

- **Tech stack**: Vite 8 + React 19 + TypeScript 5.9 (frontend), Node.js + SQLite (backend) — already set up, don't change framework
- **Design**: Custom CSS with Glassmorphism, Floating Lines background — no Tailwind, no UI frameworks
- **Charts**: Recharts 3.8 — already installed
- **Animations**: motion/react 12.36 — already installed
- **Testing**: Vitest for unit/integration tests, Playwright for UI testing
- **Tax law**: German crypto tax rules as of 2024 (1.000€ Freigrenze, FIFO, Haltefrist rules)
- **Local only**: No server deployment, runs via `npm run dev`

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Node.js backend over Python | Keep entire stack in one ecosystem (TS/JS), easier to integrate with Vite dev server | — Pending |
| SQLite over IndexedDB | Real database with SQL queries, easier FIFO calculations, persists across browsers | — Pending |
| Bitget API for price resolution | Need historical EUR prices at trade timestamps for accurate tax calculation. Research needed for best approach. | — Pending |
| Multi-year from v1 | User trades across years, needs year-over-year comparison and per-year tax reports | — Pending |
| Anlage SO summary + full appendix | Finanzamt expects summary matching tax form fields, plus detailed evidence | — Pending |

---
*Last updated: 2026-03-21 after initialization*
