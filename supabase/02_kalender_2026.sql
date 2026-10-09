-- Kalender und Fahrer der Saison 2026 (Stand 9.10.2026), einmalig von Hand einfügen.
-- Später übernimmt das der stündliche Sync-Job (scripts/tippspiel.mjs) auf GitHub.
-- Kann gefahrlos mehrmals ausgeführt werden (bestehende Einträge werden aktualisiert).

insert into public.events (id, season, round, name, circuit_id, country, quali_start, sprint_quali_start, sprint_start, race_start) values
  ('2026-01', 2026, 1, 'Australian Grand Prix', 'albert_park', 'Australia', '2026-03-07T05:00:00.000Z', null, null, '2026-03-08T04:00:00.000Z'),
  ('2026-02', 2026, 2, 'Chinese Grand Prix', 'shanghai', 'China', '2026-03-14T07:00:00.000Z', '2026-03-13T07:30:00.000Z', '2026-03-14T03:00:00.000Z', '2026-03-15T07:00:00.000Z'),
  ('2026-03', 2026, 3, 'Japanese Grand Prix', 'suzuka', 'Japan', '2026-03-28T06:00:00.000Z', null, null, '2026-03-29T05:00:00.000Z'),
  ('2026-04', 2026, 4, 'Miami Grand Prix', 'miami', 'USA', '2026-05-02T20:00:00.000Z', '2026-05-01T20:30:00.000Z', '2026-05-02T16:00:00.000Z', '2026-05-03T20:00:00.000Z'),
  ('2026-05', 2026, 5, 'Canadian Grand Prix', 'villeneuve', 'Canada', '2026-05-23T20:00:00.000Z', '2026-05-22T20:30:00.000Z', '2026-05-23T16:00:00.000Z', '2026-05-24T20:00:00.000Z'),
  ('2026-06', 2026, 6, 'Monaco Grand Prix', 'monaco', 'Monaco', '2026-06-06T14:00:00.000Z', null, null, '2026-06-07T13:00:00.000Z'),
  ('2026-07', 2026, 7, 'Barcelona Grand Prix', 'catalunya', 'Spain', '2026-06-13T14:00:00.000Z', null, null, '2026-06-14T13:00:00.000Z'),
  ('2026-08', 2026, 8, 'Austrian Grand Prix', 'red_bull_ring', 'Austria', '2026-06-27T14:00:00.000Z', null, null, '2026-06-28T13:00:00.000Z'),
  ('2026-09', 2026, 9, 'British Grand Prix', 'silverstone', 'UK', '2026-07-04T15:00:00.000Z', '2026-07-03T15:30:00.000Z', '2026-07-04T11:00:00.000Z', '2026-07-05T14:00:00.000Z'),
  ('2026-10', 2026, 10, 'Belgian Grand Prix', 'spa', 'Belgium', '2026-07-18T14:00:00.000Z', null, null, '2026-07-19T13:00:00.000Z'),
  ('2026-11', 2026, 11, 'Hungarian Grand Prix', 'hungaroring', 'Hungary', '2026-07-25T14:00:00.000Z', null, null, '2026-07-26T13:00:00.000Z'),
  ('2026-12', 2026, 12, 'Dutch Grand Prix', 'zandvoort', 'Netherlands', '2026-08-22T14:00:00.000Z', '2026-08-21T14:30:00.000Z', '2026-08-22T10:00:00.000Z', '2026-08-23T13:00:00.000Z'),
  ('2026-13', 2026, 13, 'Italian Grand Prix', 'monza', 'Italy', '2026-09-05T14:00:00.000Z', null, null, '2026-09-06T13:00:00.000Z'),
  ('2026-14', 2026, 14, 'Spanish Grand Prix', 'madring', 'Spain', '2026-09-12T14:00:00.000Z', null, null, '2026-09-13T13:00:00.000Z'),
  ('2026-15', 2026, 15, 'Azerbaijan Grand Prix', 'baku', 'Azerbaijan', '2026-09-25T12:00:00.000Z', null, null, '2026-09-26T11:00:00.000Z'),
  ('2026-16', 2026, 16, 'Bahrain Grand Prix in Malaysia', 'sepang', 'Malaysia', '2026-10-03T08:00:00.000Z', null, null, '2026-10-04T07:00:00.000Z'),
  ('2026-17', 2026, 17, 'Singapore Grand Prix', 'marina_bay', 'Singapore', '2026-10-10T13:00:00.000Z', '2026-10-09T12:30:00.000Z', '2026-10-10T09:00:00.000Z', '2026-10-11T12:00:00.000Z'),
  ('2026-18', 2026, 18, 'United States Grand Prix', 'americas', 'USA', '2026-10-24T21:00:00.000Z', null, null, '2026-10-25T20:00:00.000Z'),
  ('2026-19', 2026, 19, 'Mexico City Grand Prix', 'rodriguez', 'Mexico', '2026-10-31T21:00:00.000Z', null, null, '2026-11-01T20:00:00.000Z'),
  ('2026-20', 2026, 20, 'Brazilian Grand Prix', 'interlagos', 'Brazil', '2026-11-07T18:00:00.000Z', null, null, '2026-11-08T17:00:00.000Z'),
  ('2026-21', 2026, 21, 'Las Vegas Grand Prix', 'vegas', 'USA', '2026-11-21T04:00:00.000Z', null, null, '2026-11-22T04:00:00.000Z'),
  ('2026-22', 2026, 22, 'Qatar Grand Prix', 'losail', 'Qatar', '2026-11-28T18:00:00.000Z', null, null, '2026-11-29T16:00:00.000Z'),
  ('2026-23', 2026, 23, 'Abu Dhabi Grand Prix', 'yas_marina', 'UAE', '2026-12-05T14:00:00.000Z', null, null, '2026-12-06T13:00:00.000Z')
on conflict (id) do update set name = excluded.name, circuit_id = excluded.circuit_id, country = excluded.country,
  quali_start = excluded.quali_start, sprint_quali_start = excluded.sprint_quali_start, sprint_start = excluded.sprint_start,
  race_start = excluded.race_start, status = 'scheduled', updated_at = now();

insert into public.season_drivers (season, driver_id, code, given_name, family_name, team_id, number, active) values
  (2026, 'antonelli', 'ANT', 'Andrea Kimi', 'Antonelli', 'mercedes', '12', true),
  (2026, 'russell', 'RUS', 'George', 'Russell', 'mercedes', '63', true),
  (2026, 'hamilton', 'HAM', 'Lewis', 'Hamilton', 'ferrari', '44', true),
  (2026, 'leclerc', 'LEC', 'Charles', 'Leclerc', 'ferrari', '16', true),
  (2026, 'norris', 'NOR', 'Lando', 'Norris', 'mclaren', '1', true),
  (2026, 'max_verstappen', 'VER', 'Max', 'Verstappen', 'red_bull', '3', true),
  (2026, 'piastri', 'PIA', 'Oscar', 'Piastri', 'mclaren', '81', true),
  (2026, 'hadjar', 'HAD', 'Isack', 'Hadjar', 'red_bull', '6', true),
  (2026, 'lawson', 'LAW', 'Liam', 'Lawson', 'rb', '30', true),
  (2026, 'gasly', 'GAS', 'Pierre', 'Gasly', 'alpine', '10', true),
  (2026, 'arvid_lindblad', 'LIN', 'Arvid', 'Lindblad', 'rb', '41', true),
  (2026, 'colapinto', 'COL', 'Franco', 'Colapinto', 'alpine', '43', true),
  (2026, 'bearman', 'BEA', 'Oliver', 'Bearman', 'haas', '87', true),
  (2026, 'bortoleto', 'BOR', 'Gabriel', 'Bortoleto', 'audi', '5', true),
  (2026, 'hulkenberg', 'HUL', 'Nico', 'Hülkenberg', 'audi', '27', true),
  (2026, 'ocon', 'OCO', 'Esteban', 'Ocon', 'haas', '31', true),
  (2026, 'alonso', 'ALO', 'Fernando', 'Alonso', 'aston_martin', '14', true),
  (2026, 'sainz', 'SAI', 'Carlos', 'Sainz', 'williams', '55', true),
  (2026, 'albon', 'ALB', 'Alexander', 'Albon', 'williams', '23', true),
  (2026, 'tsunoda', 'TSU', 'Yuki', 'Tsunoda', 'rb', '22', false),
  (2026, 'stroll', 'STR', 'Lance', 'Stroll', 'aston_martin', '18', true),
  (2026, 'bottas', 'BOT', 'Valtteri', 'Bottas', 'cadillac', '77', true),
  (2026, 'perez', 'PER', 'Sergio', 'Pérez', 'cadillac', '11', true)
on conflict (season, driver_id) do update set code = excluded.code, given_name = excluded.given_name, family_name = excluded.family_name,
  team_id = excluded.team_id, number = excluded.number, active = excluded.active;
