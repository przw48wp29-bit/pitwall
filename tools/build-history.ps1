# Erstellt data/champions.json (alle Weltmeister) und data/careers.json (Karrierezahlen der aktuellen Fahrer).
$J = 'https://api.jolpi.ca/ergast/f1'
function Get($p) {
  for ($i = 0; $i -lt 5; $i++) {
    try { $r = Invoke-RestMethod "$J/$p"; Start-Sleep -Milliseconds 330; return $r.MRData } catch { Start-Sleep -Seconds (3 * ($i + 1)) }
  }
  throw "fehlgeschlagen: $p"
}
$current = [int](Get 'current.json?limit=1').RaceTable.season
$champs = @()
for ($y = 1950; $y -lt $current; $y++) {
  $d = (Get "$y/driverStandings/1.json").StandingsTable.StandingsLists[0].DriverStandings[0]
  $c = $null
  if ($y -ge 1958) { $c = (Get "$y/constructorStandings/1.json").StandingsTable.StandingsLists[0].ConstructorStandings[0] }
  $champs += [ordered]@{
    season = "$y"
    driver = [ordered]@{ driverId = $d.Driver.driverId; givenName = $d.Driver.givenName; familyName = $d.Driver.familyName; nationality = $d.Driver.nationality; url = $d.Driver.url }
    teams = @($d.Constructors | % { [ordered]@{ constructorId = $_.constructorId; name = $_.name } })
    points = $d.points; wins = $d.wins
    constructor = $(if ($c) { [ordered]@{ constructorId = $c.Constructor.constructorId; name = $c.Constructor.name; points = $c.points } } else { $null })
  }
  Write-Host $y
}
$enc = New-Object Text.UTF8Encoding $false
[IO.File]::WriteAllText((Join-Path (Get-Location) 'f1-hub\data\champions.json'), (ConvertTo-Json @($champs) -Depth 5), $enc)

$titles = @{}; $champs | % { $titles[$_.driver.driverId] = 1 + [int]$titles[$_.driver.driverId] }
$drivers = (Get 'current/driverStandings.json').StandingsTable.StandingsLists[0].DriverStandings
$careers = [ordered]@{}
foreach ($s in $drivers) {
  $id = $s.Driver.driverId
  $seasons = @{}; $starts = 0; $wins = 0; $pod = 0; $off = 0; $total = 1
  while ($off -lt $total) {
    $r = Get "drivers/$id/results.json?limit=100&offset=$off"
    $total = [int]$r.total
    foreach ($race in $r.RaceTable.Races) { $seasons[$race.season] = 1; $starts++; $p = $race.Results[0].position; if ($p -eq '1') { $wins++ }; if ([int]$p -le 3) { $pod++ } }
    $off += 100
  }
  $poles = [int](Get "drivers/$id/qualifying/1.json?limit=1").total
  $careers[$id] = [ordered]@{ seasons = $seasons.Count; starts = $starts; wins = $wins; podiums = $pod; poles = $poles; titles = [int]$titles[$id]; first = ($seasons.Keys | Sort-Object | Select-Object -First 1) }
  Write-Host "$id $starts"
}
[IO.File]::WriteAllText((Join-Path (Get-Location) 'f1-hub\data\careers.json'), (ConvertTo-Json $careers -Depth 4), $enc)
Write-Host 'fertig'
