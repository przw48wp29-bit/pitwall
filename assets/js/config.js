// Statische Stammdaten. Alles, was sich während der Saison ändert, kommt aus
// den APIs bzw. aus data/editorial.json (tägliches Update).

export const API = {
  jolpica: 'https://api.jolpi.ca/ergast/f1',
  openf1: 'https://api.openf1.org/v1',
  wiki: 'https://en.wikipedia.org/api/rest_v1/page/summary/',
  meteo: 'https://api.open-meteo.com/v1/forecast',
};

// Teamfarben wie in den offiziellen F1-Grafiken. Unbekannte Teams (z. B. ab
// nächster Saison) bekommen automatisch eine neutrale Farbe.
export const TEAMS = {
  mercedes:     { color: '#27f4d2', dark: '#06302a', short: 'Mercedes',     car: 'W17',     carWiki: 'Mercedes_W17',          pu: 'Mercedes',       base: 'Brackley, GB',            principal: 'Toto Wolff' },
  ferrari:      { color: '#e8002d', dark: '#3d000c', short: 'Ferrari',      car: 'SF-26',   carWiki: 'Ferrari_SF-26',         pu: 'Ferrari',        base: 'Maranello, IT',           principal: 'Frédéric Vasseur' },
  mclaren:      { color: '#ff8000', dark: '#402000', short: 'McLaren',      car: 'MCL40',   carWiki: 'McLaren_MCL40',         pu: 'Mercedes',       base: 'Woking, GB',              principal: 'Andrea Stella' },
  red_bull:     { color: '#3671c6', dark: '#0c1b33', short: 'Red Bull',     car: 'RB22',    carWiki: 'Red_Bull_RB22',         pu: 'Red Bull Ford',  base: 'Milton Keynes, GB',       principal: 'Laurent Mekies' },
  rb:           { color: '#6692ff', dark: '#0a1d52', short: 'Racing Bulls', car: 'VCARB 03',carWiki: 'Racing_Bulls_VCARB_03', pu: 'Red Bull Ford',  base: 'Faenza, IT',              principal: 'Alan Permane' },
  alpine:       { color: '#00a1e8', dark: '#002a3d', short: 'Alpine',       car: 'A526',    carWiki: 'Alpine_A526',           pu: 'Mercedes',       base: 'Enstone, GB',             principal: 'Flavio Briatore' },
  aston_martin: { color: '#229971', dark: '#082a1e', short: 'Aston Martin', car: 'AMR26',   carWiki: 'Aston_Martin_AMR26',    pu: 'Honda',          base: 'Silverstone, GB',         principal: 'Adrian Newey' },
  williams:     { color: '#1868db', dark: '#08203f', short: 'Williams',     car: 'FW48',    carWiki: 'Williams_FW48',         pu: 'Mercedes',       base: 'Grove, GB',               principal: 'James Vowles' },
  haas:         { color: '#dee1e2', dark: '#3b4144', short: 'Haas',         car: 'VF-26',   carWiki: 'Haas_VF-26',            pu: 'Ferrari',        base: 'Kannapolis, US',          principal: 'Ayao Komatsu' },
  audi:         { color: '#ff2d00', dark: '#3d0b00', short: 'Audi',         car: 'R26',     carWiki: 'Audi_R26',              pu: 'Audi',           base: 'Hinwil, CH',              principal: 'Jonathan Wheatley' },
  cadillac:     { color: '#aaaaad', dark: '#2c2c2e', short: 'Cadillac',     car: 'MAC-26',  carWiki: 'Cadillac_MAC-26',       pu: 'Ferrari',        base: 'Fishers, US',             principal: 'Graeme Lowdon' },
};

export function team(id) {
  return TEAMS[id] || { color: '#8a8a93', dark: '#26262b', short: id ? id.replace(/_/g, ' ') : '–', car: '', pu: '', base: '', principal: '' };
}

// Nationalität (Jolpica) -> ISO-Ländercode für Flaggen-Bilder.
// Bilder statt Emoji, weil Windows keine Flaggen-Emoji darstellt.
export const NATIONALITY = {
  British: 'gb', Italian: 'it', Monegasque: 'mc', Dutch: 'nl', Australian: 'au', French: 'fr',
  'New Zealander': 'nz', Argentine: 'ar', Argentinian: 'ar', Brazilian: 'br', German: 'de', Spanish: 'es',
  Thai: 'th', Japanese: 'jp', Finnish: 'fi', Mexican: 'mx', Canadian: 'ca', American: 'us',
  Chinese: 'cn', Danish: 'dk', Swedish: 'se', Swiss: 'ch', Austrian: 'at', Belgian: 'be', Polish: 'pl',
  Russian: 'ru', Estonian: 'ee', Indian: 'in', Irish: 'ie', Israeli: 'il', Colombian: 'co', Venezuelan: 've',
};
export const COUNTRY = {
  Australia: 'au', China: 'cn', Japan: 'jp', USA: 'us', 'United States': 'us', Canada: 'ca', Monaco: 'mc',
  Spain: 'es', Austria: 'at', UK: 'gb', 'United Kingdom': 'gb', Belgium: 'be', Hungary: 'hu', Netherlands: 'nl',
  Italy: 'it', Azerbaijan: 'az', Malaysia: 'my', Singapore: 'sg', Mexico: 'mx', Brazil: 'br', Qatar: 'qa',
  UAE: 'ae', 'United Arab Emirates': 'ae', Bahrain: 'bh', 'Saudi Arabia': 'sa', Portugal: 'pt', France: 'fr',
  Germany: 'de', Russia: 'ru', Turkey: 'tr', Argentina: 'ar', 'South Africa': 'za', Korea: 'kr', India: 'in', Vietnam: 'vn',
};

export const SESSION_NAMES = {
  FirstPractice: 'Practice 1', SecondPractice: 'Practice 2', ThirdPractice: 'Practice 3',
  SprintQualifying: 'Sprint Qualifying', Sprint: 'Sprint', Qualifying: 'Qualifying', Race: 'Race',
};

// Punkteschema (für den Titelrechner).
export const POINTS = { race: 25, sprint: 8 };

// Tippspiel: Zugangsdaten der Gratis-Datenbank (Supabase), siehe README.
//   supabaseUrl: "Project URL", z. B. 'https://abcd1234.supabase.co'
//   supabaseKey: "Publishable key" (sb_publishable_…) oder der alte "anon"-Key.
// Beide sind für den Browser gedacht und dürfen öffentlich sein: Was erlaubt
// ist, entscheidet die Datenbank (supabase/01_tippspiel.sql). Den geheimen
// "Secret key" NIE hier eintragen, der gehört nur in die GitHub-Secrets.
// Leer = Demo-Modus (alles nur lokal im Browser).
export const TIPPSPIEL = {
  supabaseUrl: 'https://vkddowhbwmvqmqzocljf.supabase.co',
  supabaseKey: 'sb_publishable_NDm5MRqg9k3NUlVuk_ryag_4yLBMwDB',
};

export const TV_CH = [
  { name: 'SRF zwei / Play SRF', note: 'Gratis, Rennen live im TV oder Stream', url: 'https://www.srf.ch/sport/motorsport/formel-1' },
  { name: 'F1 TV Pro', note: 'Alle Sessions live, Onboards, Live-Timing (Abo)', url: 'https://f1tv.formula1.com' },
  { name: 'Offizielles Live Timing', note: 'Gratis-Positionen während der Session', url: 'https://www.formula1.com/en/timing/f1-live' },
];

// News-Feeds (RSS), die alle 2 Stunden gratis abgerufen werden (scripts/news.mjs).
export const NEWS_FEEDS = [
  { id: 'formel1de', name: 'Formel1.de', lang: 'de', url: 'https://www.formel1.de/rss/news/feed.xml', home: 'https://www.formel1.de' },
  { id: 'f1com', name: 'Formula1.com', lang: 'en', url: 'https://www.formula1.com/en/latest/all.xml', home: 'https://www.formula1.com/en/latest' },
];

export const NEWS_SOURCES = [
  { name: 'Formula1.com', url: 'https://www.formula1.com/en/latest', note: 'Offizielle News' },
  { name: 'FIA Dokumente', url: 'https://www.fia.com/documents/championships/fia-formula-one-world-championship-14', note: 'Strafen, Upgrade-Listen, Entscheide' },
  { name: 'The Race', url: 'https://www.the-race.com/formula-1/', note: 'Analysen & Technik' },
  { name: 'Motorsport.com', url: 'https://www.motorsport.com/f1/news/', note: 'News & Gerüchte' },
  { name: 'RacingNews365', url: 'https://racingnews365.com/', note: 'News & Transfers' },
  { name: 'Speedweek', url: 'https://www.speedweek.com/formel1/', note: 'Deutschsprachig' },
];
