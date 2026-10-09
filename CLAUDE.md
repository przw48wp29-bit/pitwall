# Pitwall – Projektnotizen für Claude

Private F1-Fanseite mit **Tippspiel für Freunde** (Hauptteil). Besitzer: Elias. Sprache der Seite und der Kommunikation: **Deutsch, Schweizer Rechtschreibung (immer «ss», nie «ß»)**, F1-Fachbegriffe dürfen englisch bleiben. Zeitzone Europe/Zurich.

## Arbeitsweise mit Elias
- Bei grösseren Vorhaben **zuerst Plan mit offenen Fragen**, erst nach seinem OK bauen.
- Er möchte, dass Claude sich **selbst kontrolliert** (im Browser durchklicken, Desktop + Handy 375 px, Tests) und Verbesserungen vorschlägt.
- **Alles muss gratis laufen.** Keine bezahlten Dienste einführen. KI-Recherche (Anthropic API) ist optional und standardmässig aus.
- Professionelle Optik im Stil von formula1.com (Carbon-Dunkel #15151e, Rot #e10600, Saira kursiv/breit für Titel, Titillium Web für Text). Bilder nur Wikimedia (kuratiert in data/media.json), keine Pressefotos, keine offiziellen Logos.
- Erst auf GitHub, wenn es «perfekt» ist. Elias hat kein Node.js und kein git auf dem Arbeits-PC; Upload über die GitHub-Weboberfläche.
- Konten (Supabase, GitHub, Anthropic) legt Elias selbst an; Claude gibt Schritt-für-Schritt-Anleitungen (README).

## Technik
- Statische Single-Page-App, Vanilla ES-Module, **kein Build-Schritt**, Hash-Router in `assets/js/app.js` (Routen-Tabelle oben).
- Daten: Jolpica (live), OpenF1, Open-Meteo, Wikimedia; täglicher Snapshot und Archiv in `data/` (erzeugt von `scripts/update.mjs` via GitHub Action 06:00 Zürich).
- News: RSS (Formel1.de, Formula1.com) → `scripts/news.mjs` alle 2 h → `data/news.json`. Logik in `assets/js/news-feed.js` (rein, getestet).
- Tippspiel-Backend: **Supabase** (Postgres + Auth E-Mail/Passwort, Gratis-Plan). Schema und alle Regeln in `supabase/01_tippspiel.sql`:
  - RLS + Trigger erzwingen Tippschluss, Sichtbarkeit (fremde Tipps erst nach Tippschluss), Admin-Rechte, Fahrer-Validierung.
  - Browser ruft fast nur RPC-Funktionen auf (`season_data`, `my_groups`, `create_group`, `join_group`, `event_state`, `save_tips`, `group_event`, `delete_account` …), alle liefern JSON.
  - `events`/`season_drivers` schreibt nur der Sync-Job `scripts/tippspiel.mjs` (stündlich, Service-Key als GitHub-Secret).
- **Demo-Modus** (ohne Supabase-Zugangsdaten in `config.js` oder mit `?demo`): dasselbe SQL in **PGlite** (Postgres als WASM) im Browser, plus `supabase/dev/compat.sql` (auth-Schema, Rollen). Code: `assets/js/tipp/dev.js`, `pg.js`.
- Tests: `tests/*.test.js` mit Mini-Harness, laufen im Browser (`/tests/`) und in Node (`npm test`, GitHub Action `tests.yml`). DB-Tests gegen echtes Postgres (PGlite).
- Lokaler Server: `tools/serve.ps1` (Port 8899), Vorschau-Konfiguration in `.claude/launch.json` («pitwall»).
- Kein Node lokal → Node-Skripte im Browser prüfen: Module per Web Worker laden (kein DOM), Logik als reine Funktionen in `assets/js/` halten.

## Stand des Tippspiels (Stufen nach Elias' Vorgabe)
- **Stufe A – fertig (Okt. 2026):** Konto (E-Mail + Passwort), Profil (Name, Avatar: Farbe oder Lieblingsfahrer), Gruppen (erstellen, Einladungslink/Code, mehrere pro Person), Admin (Regeln, Rollen, entfernen, Code erneuern, löschen), Tipps (Quali Top 3 / Sprint-Podium / Rennen Top 10 / Zusatztipps) mit Tippschluss pro Gruppe (früh/spät), «letzten Tipp übernehmen» oder 0, Tippübersicht verdeckt bis Tippschluss, Konto löschen.
- **Supabase live (9.10.2026):** Projekt `vkddowhbwmvqmqzocljf` (Region Zürich, «Confirm email» aus, «Automatically expose new tables» aus, automatische RLS an). `01_tippspiel.sql` und `02_kalender_2026.sql` eingespielt, URL und Publishable Key in `config.js`. Live geprüft: Gruppe, Tipp, Tippschluss, Validierung, RLS-Umgehungsversuche blockiert. GitHub-Repo noch nicht angelegt (Sync-Job läuft daher noch nicht).
- **Stufe B – gebaut 9.10.2026 (Live-SQL muss Elias neu einspielen):** Punkte in SQL (`points_preset`, reine Funktion `score_kind`, `score_group_event` mit Aussenseiter-Bonus), Trigger rechnen bei neuem/geändertem Resultat (`results_hash`) und Absage neu; `group_events.dotd` (Admin), `adjustments`, `scores`; RPCs `group_standings`, `set_dotd`, `add_adjustment`, `delete_adjustment`. Resultat-Import in `scripts/tippspiel.mjs` via `resultsFromSources` (sync.js). UI: `standings.js` (Rangliste Saison/Monat/Rennen, Verlaufsgrafik, Aufschlüsselung), Ranglogik `ranking.js`. Tests: `tests/scoring.test.js` (54 Tests total).
- **Stufe B – ursprüngliche Planung:** Punktesystem (Vorlagen Einfach/Standard/Profi als JSON-Konfiguration in `group_seasons.settings`), reine Punktefunktion mit Unit-Tests (Joker, DSQ, Absage, Korrektur, Gleichstand), Resultat-Import (Jolpica + OpenF1 race_control für Safety Car) in `events.results` mit Prüfsumme, automatische Neuberechnung, `scores` mit Aufschlüsselung, `adjustments` (manuelle Korrekturen), Ranglisten (Rennen/Monat/Saison), Verlaufsgrafik. Fahrer des Tages trägt der Admin ein (keine freie Datenquelle).
- **Stufe C:** Langzeittipps (WM, Konstrukteure, Teamduelle, Siege, Rookie; Anpassung zur Saisonhälfte mit Abzug), Joker, Auszeichnungen, Statistiken, ewige Rangliste, Saison starten/abschliessen.
- **Stufe D:** Kommentare/Reaktionen, Pinnwand, Wetteinsatz-Notiz, Benachrichtigungen (Web Push gratis; E-Mail via Gmail/Brevo-SMTP optional).
- Testsaison: letzte 6 Rennen 2026 (ab USA-GP), richtig los 2027.
- Details, Punktetabelle und Datenmodell: `docs/tippspiel-konzept.md`.
