# Phase 7: Exchange API + Security - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Protect the app with single-user password authentication, encrypt exchange API credentials at rest (AES-256-GCM + PBKDF2), and enable direct Bitget trade sync via ccxt — eliminating manual CSV exports. The UI gains a new Settings tab for exchange management and app configuration.

</domain>

<decisions>
## Implementation Decisions

### Login & session handling
- First-launch setup screen — app detects no password set and shows "Create your password" before anything else
- Session lasts until browser tab closes (session cookie, no expiry timer)
- Minimal login card — centered, clean, password field + login button
- Wrong password shows simple "Falsches Passwort" error, no lockout, unlimited retries
- Logout button available in UI (clears session)

### Credential entry & storage UX
- New "Einstellungen" (Settings) tab alongside Dashboard/Transaktionen/Steuerreport
- API key + secret fields are masked (password-type) with eye icon toggle to reveal temporarily
- Auto-test on save — after saving credentials, app calls Bitget account info endpoint to verify they work; shows green checkmark or red error
- Extensible for multiple exchanges but ships with Bitget first — dropdown/list structure ready for future additions

### Sync behavior & feedback
- Manual sync button + auto-sync on app open (fetch new trades on launch)
- Live progress during sync — trade count updating in real time
- Partial import on failure — if spot succeeds but futures fails, import what was fetched + show warning for failed portion
- Toast notification on completion — auto-dismiss with key numbers (X neue Trades, Y Duplikate, Z Fehler), click to expand details

### Exchange management UI
- Claude's Discretion: Layout style for exchange cards/list (cards vs table — Claude picks)
- Per-exchange sync button + "Alle synchronisieren" button at the top
- Delete connection shows confirm dialog: "Verbindung entfernen? Bereits importierte Trades bleiben erhalten." — trades always kept
- Combined settings page — Settings tab houses exchange management AND password change / app settings in one place

### Claude's Discretion
- Exchange card/list layout design
- Settings tab section ordering and visual hierarchy
- Login card styling details (spacing, animation)
- Toast notification duration and positioning
- Auto-sync timing (immediate on open vs. delayed)
- Progress indicator implementation (spinner, progress bar, inline text)

</decisions>

<specifics>
## Specific Ideas

- Settings tab as a combined page: exchanges at top, app settings (password change) below
- Exchange connection extensible — data model supports multiple exchanges even though only Bitget ships now
- Sync uses existing import pipeline (normalizer, deduplication) — API-fetched trades go through the same path as CSV imports
- German UI labels consistent with existing tabs (Einstellungen, Synchronisieren, Verbindung testen)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-exchange-api-security*
*Context gathered: 2026-03-23*
