# Tippspiel – Konzept und Entscheide

Stand: 9. Oktober 2026. Abgestimmt mit Elias.

## Entscheide

| Thema | Entscheid |
|---|---|
| Kosten | Alles gratis. Supabase Free als Server, GitHub Actions für Sync und Auswertung. KI-Recherche optional. |
| News | RSS-Feeds seriöser Medien (Formel1.de, Formula1.com), grafisch aufbereitet, Link zum Original. Keine KI. |
| Login | E-Mail + Passwort. «Confirm email» in Supabase aus. Magic Link / Passwort vergessen erst mit Gratis-SMTP (Stufe D). |
| Start | Testsaison mit den letzten 6 Rennen 2026, richtig ab 2027. |
| Tipp-Arten | Quali: Top 3 in Reihenfolge, P1 = Pole. Rennen: Top 10, P1–P3 = Podium. Sprint: Podium. Zusatz: schnellste Runde, Fahrer des Tages, Safety-Car-Einsätze (0–4+), Ausfälle (0–6+), erster Ausfall. |
| Definitionen | Ausfall = im Rennen ausgeschieden, auch wenn wegen genug Runden noch gewertet (DSQ und Nichtstart zählen nicht). Erster Ausfall = wenigste Runden, bei Gleichstand zählen alle. Safety Car = nur echtes SC, kein VSC. |
| Tippschluss | Pro Gruppe: «früh» (alles beim Qualifying-Start, Sprint beim Sprint-Qualifying) oder «spät» (Rennen/Zusatz beim Rennstart, Sprint beim Sprintstart). Server erzwingt. |
| Fehlende Tipps | Pro Gruppe: letzten Tipp derselben Art übernehmen (gleiche Saison) oder 0 Punkte. |
| Mehrere Gruppen | Ein Tipp kann für alle Gruppen gleichzeitig gespeichert werden; gespeichert wird pro Gruppe. |
| Joker | Verdoppelt alle Punkte eines Wochenendes, setzen bis zum ersten Tippschluss, bei Absage zurück. (Stufe C) |
| Avatar | Initialen in Wunschfarbe oder Foto des Lieblingsfahrers (Wikimedia), kein Upload. |
| Fahrer des Tages | Admin trägt ein (keine freie Datenquelle). |

## Datenmodell (Supabase / Postgres)

| Tabelle | Inhalt | Stufe |
|---|---|---|
| `profiles` | Name, Avatar | A |
| `groups` | Name, Einladungscode | A |
| `memberships` | Gruppe, Nutzer, Rolle (admin/member) | A |
| `group_seasons` | Einstellungen pro Gruppe und Saison (preset, lock, missing, jokers, später points), Status, Schlussrangliste | A (Einstellungen), C (Status) |
| `events` | Rennwochenenden aus Jolpica (Session-Zeiten UTC, Status), später `results` + `results_hash` | A, B |
| `season_drivers` | Fahrerfeld pro Saison, aktiv ja/nein | A |
| `tips` | Gruppe, Nutzer, Event, Art, Auswahl (JSON), Herkunft (user/auto), Zeitstempel | A |
| `scores` | Punkte pro Nutzer/Gruppe/Event mit Aufschlüsselung, Resultat-Prüfsumme | B |
| `adjustments` | manuelle Korrekturen mit Begründung | B |
| `jokers`, `season_tips`, `awards` | Joker, Langzeittipps (Version 1/2), Auszeichnungen | C |
| `posts`, `reactions`, `bets`, `push_subs` | Kommentare/Pinnwand, Reaktionen, Wetteinsatz, Push-Geräte | D |

## Punkte-Vorlagen (Stufe B, als JSON in `group_seasons.settings.points`)

| | Einfach | Standard | Profi |
|---|---|---|---|
| Aktive Tipps | Pole, Podium, schnellste Runde | alle | alle |
| Pole | 3 | 4 | 5 |
| Quali P2/P3 exakt · im Top 3 falsch | – | 3 · 1 | 3 · 1 |
| Podium exakt · im Podium falsch | 3 · 1 | 5 · 2 | 6 · 2 |
| P4–P10 exakt · in Top 10 falsch | – | 2 · 1 | 3 · 1 (1 Platz daneben: 2) |
| Sprint-Podium exakt · falsch | – | 3 · 1 | 3 · 1 |
| Bonus perfektes Podium / Top 3 / Top 10 | +3 / – / – | +5 / +3 / +10 | +5 / +3 / +20 |
| Schnellste Runde · Fahrer des Tages | 2 · – | 2 · 2 | 2 · 2 |
| SC ja/nein · SC-Anzahl · Ausfälle (±1) · erster Ausfall | – | 1 · 2 · 3 (1) · 3 | 1 · 3 · 3 (1) · 4 |
| Aussenseiter-Bonus (exakte Treffer) | aus | +1 (≤ 25 % der Gruppe), +2 (allein) | +2 / +4 |
| Joker pro Saison | 2 | 3 | 2 |
| Weltmeister · Konstrukteure | 10 · 5 | 15 · 10 | 20 · 12 |
| Teamduell je · Rookie · Siege exakt (±1) | – | 2 · 5 · 5 (2) | 2 · 5 · 8 (3) |
| Abzug pro geändertem Langzeittipp | −3 | −3 | −5 |

Gleichstand: zuerst mehr exakte Treffer, dann mehr Rennsiege in der Gruppe, sonst geteilter Platz.

## Seiten

| Route | Inhalt |
|---|---|
| `#/tipp` | Übersicht: nächster Tippschluss, meine Gruppen, Beitritt per Code, Kalender |
| `#/tipp/next` | springt zum nächsten offenen Tipp |
| `#/tipp/JJJJ-RR` | Tipp-Formular (Plätze antippen, Fahrer wählen, Ziehen zum Sortieren, Vorschläge, Spickzettel) |
| `#/gruppe/neu` | Gruppe gründen |
| `#/gruppe/<id>` | Gruppe: nächstes Wochenende, wer hat getippt, Einladung, Mitglieder |
| `#/gruppe/<id>/rennen/JJJJ-RR` | Tipps aller Mitglieder (verdeckt bis Tippschluss) |
| `#/gruppe/<id>/admin` | Einstellungen, Rollen, Mitglieder, Code, Löschen |
| `#/beitreten/<code>` | Einladungslink |
| `#/login`, `#/profil` | Anmelden/Registrieren, Profil, Passwort, Konto löschen |
