# Pitwall – F1 Hub mit Tippspiel

Eine F1-Seite im Stil moderner F1-Medien, mit einem **Tippspiel für Freunde** als Hauptteil. Alles läuft **gratis**.

- **Tippspiel:** private Gruppen, Einladungslink, Tipps für Qualifying, Sprint, Rennen und Zusatztipps, Tippschluss mit Countdown. Was die anderen getippt haben, wird erst nach dem Tippschluss aufgedeckt. Nach jeder Session wertet die Datenbank automatisch aus: Punkte mit Aufschlüsselung, Ranglisten pro Rennen, Monat und Saison, Punkteverlauf.
- **F1-Infos als Datengrundlage:** WM-Stand, Fahrer, Teams, Kalender, Ergebnisse, Strategie, Upgrades, Verträge, Strafen, Statistiken, Archiv, Strecken, Live-Center, News.

## So funktioniert's

| Was | Woher | Wie aktuell |
|---|---|---|
| WM-Stand, Kalender, Ergebnisse, Fahrer | [Jolpica-F1 API](https://github.com/jolpica/jolpica-f1) | live beim Seitenaufruf |
| News (Schlagzeile, Kurztext, Link) | RSS von [Formel1.de](https://www.formel1.de) und [Formula1.com](https://www.formula1.com/en/latest) | alle 2 Stunden |
| Live-Center, Strategie, Rundenzeiten | [OpenF1](https://openf1.org) | nach jeder Session (live nur mit Abo, siehe unten) |
| Wetter | [Open-Meteo](https://open-meteo.com) | live |
| Fotos von Fahrern, Autos, Strecken | Wikimedia Commons, handverlesen | neue Saison wird automatisch ergänzt |
| Weltmeister seit 1950, Karrierezahlen | Jolpica (aufbereitet) | täglich 06:00 |
| Tippspiel (Konten, Gruppen, Tipps) | [Supabase](https://supabase.com) (Gratis-Plan) | sofort |
| Upgrades, Verträge, Strafen, Prognosen | optional per KI (kostet Geld, siehe unten) | täglich 06:00, wenn eingeschaltet |

Die Seite selbst wird nie neu gebaut. Es ändern sich nur die Dateien im Ordner `data/` und die Tippspiel-Datenbank.

**Automatische Abläufe** (GitHub Actions, Ordner `.github/workflows/`):

| Ablauf | Wann | Was |
|---|---|---|
| Tägliches Update | 06:00 Uhr Schweizer Zeit | Saisondaten, Archiv, Strategie, Bilder, Kalender-Abo, News |
| News | alle 2 Stunden (06–23 Uhr) | RSS-Feeds abrufen → `data/news.json` |
| Tippspiel-Sync | stündlich | Kalender, Fahrerfeld und Resultate (Jolpica, Safety Car von OpenF1) in die Tippspiel-Datenbank; die Datenbank rechnet dann die Punkte |
| Tests | bei jeder Änderung | Tippspiel-Regeln, Datenbank, News-Abruf prüfen |

## Kosten

**Alles gratis:** GitHub (öffentliches Repository), GitHub Pages, GitHub Actions, Supabase (Gratis-Plan), Jolpica, OpenF1 (nach den Sessions), Open-Meteo, Wikimedia und die RSS-Feeds.

- Ein Supabase-Gratisprojekt schläft nach einer Woche ohne Zugriffe ein. Der stündliche Tippspiel-Sync hält es wach.
- **Optional, kostet Geld:** Die KI-Recherche für Upgrades, Verträge und Strafen läuft nur, wenn du das Secret `ANTHROPIC_API_KEY` hinterlegst (etwa 1–3 USD pro Tag). Ohne den Key bleiben diese Bereiche beim letzten Stand stehen.

## Einrichtung auf GitHub (einmalig, ca. 10 Minuten)

1. **Repository anlegen:**
   - Auf github.com oben rechts **+** → **New repository** klicken.
   - Name z. B. `pitwall`, **Public** wählen, **Create repository** klicken.
2. **Dateien hochladen:**
   - Auf der leeren Repo-Seite auf **uploading an existing file** klicken.
   - Den *Inhalt* des Ordners `Pitwall` hineinziehen, also alle Dateien und Ordner inklusive `.github`.
   - **Commit changes** klicken.
   - Wichtig: Prüfe danach, ob der Ordner `.github` im Repository erscheint. Darin stecken die automatischen Abläufe.
3. **Schreibrechte für die Abläufe:** Unter **Settings → Actions → General → Workflow permissions** die Option **Read and write permissions** wählen und speichern.
4. **Seite veröffentlichen:**
   - Unter **Settings → Pages** bei *Source* **Deploy from a branch** wählen.
   - Branch `main` und Ordner `/ (root)` wählen, dann **Save** klicken.
   - Nach 1–2 Minuten ist die Seite unter `https://<dein-name>.github.io/pitwall/` erreichbar.
5. **Erste Läufe von Hand starten:** Unter **Actions** nacheinander **Tägliches Update** und **News** öffnen und jeweils **Run workflow** klicken.

## Tippspiel einrichten (einmalig, ca. 15 Minuten)

Ohne Einrichtung läuft das Tippspiel im **Demo-Modus**. Alles funktioniert, wird aber nur im eigenen Browser gespeichert. Für das gemeinsame Spiel braucht es den Gratis-Server:

1. **Supabase-Konto und Projekt:**
   - Auf [supabase.com](https://supabase.com) ein Konto anlegen (Gratis-Plan).
   - **New project** klicken. Name z. B. `pitwall`, Region **Central EU (Zurich)**.
   - Das Datenbank-Passwort, das du dabei vergibst, gut aufbewahren.
2. **E-Mail-Bestätigung ausschalten:**
   - Links **Authentication → Sign In / Providers → Email** öffnen.
   - **Confirm email** ausschalten und speichern.
   - Warum: Der eingebaute Mailversand von Supabase schickt gratis nur an Projektmitglieder. Ohne Bestätigung können sich deine Freunde direkt mit E-Mail und Passwort anmelden.
3. **Datenbank anlegen:**
   - Links **SQL Editor → New query** öffnen.
   - Den ganzen Inhalt der Datei [supabase/01_tippspiel.sql](supabase/01_tippspiel.sql) einfügen und **Run** klicken.
   - Es sollte «Success» erscheinen.
   - **Nach jedem Update dieser Datei** dasselbe nochmals machen. Das Skript ist so gebaut, dass bestehende Konten, Gruppen und Tipps erhalten bleiben.
4. **Seite verbinden:**
   - Unter **Project Settings → API Keys** den **Publishable key** kopieren.
   - Unter **Project Settings → Data API** (oder oben über den Knopf **Connect**) die **Project URL** kopieren.
   - Beides in [assets/js/config.js](assets/js/config.js) bei `TIPPSPIEL` eintragen. Diese beiden Werte dürfen öffentlich sein.
5. **Sync-Job verbinden:**
   - In GitHub unter **Settings → Secrets and variables → Actions → New repository secret** zwei Secrets anlegen:
     - `SUPABASE_URL` mit der Project URL
     - `SUPABASE_SERVICE_KEY` mit dem **Secret key** aus **Project Settings → API Keys**
   - Der Secret key ist geheim. Er gehört nur hierhin, nie in den Code und nie in einen Chat.
6. **Kalender laden:** Unter **Actions → Tippspiel-Sync → Run workflow** starten. Danach kennt die Datenbank alle Rennwochenenden und Fahrer.
7. **Loslegen:** Seite öffnen → **Tippspiel** → **Konto erstellen** → **Gruppe gründen** → Einladungslink an deine Freunde schicken.

**Passwort vergessen?** Solange noch kein Mailversand eingerichtet ist, setzt du es im Supabase **SQL Editor** zurück. E-Mail und neues Passwort anpassen:

```sql
update auth.users set encrypted_password = crypt('NeuesPasswort123', gen_salt('bf')) where email = 'name@example.com';
```

### Regeln, die der Server erzwingt

- **Tippschluss:**
  - «Früh» (Standard): Qualifying-, Renn- und Zusatztipps schliessen beim Qualifying-Start, Sprint-Tipps beim Sprint-Qualifying.
  - «Spät»: Renn- und Sprint-Tipps schliessen erst beim Start.
  - Die Datenbank lehnt Tipps danach ab, auch wenn jemand die Seite umgeht.
- **Verdeckt:** Fremde Tipps liefert die Datenbank erst nach dem Tippschluss aus.
- **Gruppen sind privat:** Nur Mitglieder sehen Gruppe, Mitglieder und Tipps.
- **Fahrer:** Nur aktuelle Fahrer sind wählbar, und keiner kann doppelt vorkommen.
- **Punkte:** rechnet nur die Datenbank (Funktion `score_kind`), sobald ein Resultat eingetragen wird. Ändert sich ein Resultat nachträglich (Strafe, Disqualifikation), wird automatisch neu gerechnet; bei einer Absage fallen die Punkte weg. Punkte und Korrekturen kann niemand direkt verändern; Korrekturen machen nur Admins, mit Begründung, für alle sichtbar.
- **Fahrer des Tages:** gibt es nicht frei im Netz. Der Admin trägt ihn nach dem Rennen auf der Seite des Wochenendes ein (Fan-Wahl auf F1.com).
- **Datenschutz:**
  - Gespeichert werden nur E-Mail (für den Login), Name, Avatar und Tipps.
  - Konto löschen (unter **Profil**) entfernt alles sofort.
  - Alle Zeiten liegen in UTC in der Datenbank und werden in Zürcher Zeit angezeigt.

## Lokal ansehen und testen (ohne Installation)

Im Projektordner in PowerShell:

```bash
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```

Danach im Browser:

- `http://localhost:8899/` öffnet die Seite. Das Tippspiel läuft dort im Demo-Modus mit echter Datenbank-Logik.
- Unter **Werkzeuge** im Demo-Modus gibt es:
  - Testspieler (Lena, Marco, Sven, Nora; Passwort `demo1234`)
  - eine «Zeitreise» für den Tippschluss
  - ein Zufallsresultat fürs nächste Rennen (zum Ausprobieren von Punkten und Rangliste)
  - Zurücksetzen
- `http://localhost:8899/tests/` startet alle automatischen Tests im Browser.

Mit installiertem Node.js gehen die Tests auch so:

```bash
npm install
```

```bash
npm test
```

## Projektstruktur

```
Pitwall/
├─ index.html, sw.js, manifest.webmanifest   Seite (Einstieg, Offline-Cache, App-Installation)
├─ assets/css/        style.css (Seite), tipp.css (Tippspiel)
├─ assets/js/         app.js (Router, Seiten), data.js (Datenquellen), features.js, …
├─ assets/js/tipp/    Tippspiel: views.js, form.js (Tipp-Formular), api.js (Server),
│                     standings.js (Ranglisten), ranking.js, dev.js (Demo-Modus),
│                     rules.js, sync.js, pg.js, common.js
├─ data/              von den Abläufen erzeugte Daten (news.json, season.json, …)
├─ scripts/           update.mjs, news.mjs, tippspiel.mjs (laufen auf GitHub)
├─ supabase/          01_tippspiel.sql (Datenbank), dev/compat.sql (nur Demo/Tests)
├─ tests/             automatische Tests (Browser: tests/index.html, Node: run.mjs)
├─ tools/             serve.ps1 (lokaler Server), Hilfsskripte für Bilder und Archiv
├─ docs/              Konzept und Entscheide zum Tippspiel
└─ .github/workflows/ die automatischen Abläufe
```

## Kalender aufs Handy

Unter *Schedule* kannst du den Kalender herunterladen. Nach der Veröffentlichung gibt es dort zusätzlich **Kalender abonnieren**. Das Abo aktualisiert sich jeden Morgen von selbst.

## Live-Timing

OpenF1 gibt Live-Daten **während laufender Sessions nur gegen Bezahlung** heraus.

- Während einer Session zeigt das Live-Center einen Hinweis mit Link zum offiziellen Live-Timing.
- Nach der Session erscheinen Klassierung, Wetter und Race-Control-Meldungen automatisch.

## Rechtliches

Inoffizielle Fan-Seite ohne offizielle Logos.

- **Fotos:** Wikimedia Commons, den Bildnachweis zeigt das ⓘ-Symbol.
- **News:** Schlagzeile und Kurztext aus den öffentlichen RSS-Feeds, immer mit Link zum Originalartikel. Pressefotos werden nicht übernommen.
- **Marken:** „Formula 1“ und „F1“ sind Marken der Formula One Licensing B.V.
