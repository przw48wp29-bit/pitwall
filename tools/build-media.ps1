# Erstellt f1-hub/data/media.json mit handverlesenen Wikimedia-Bildern + Bildnachweis.
# Batch-Abfragen (bis 50 Dateien pro Request), damit Wikimedia nicht drosselt.
$ua = "PitwallCurator/1.0 (private fan site)"
$ue = [char]0xFC
$prefix = 'FIA F1 Austria 2026 Nr. '
$driverCars = [ordered]@{
  norris='1 Norris (1)'; gasly='10 Gasly (1)'; perez='11 Perez (1)'; antonelli='12 Antonelli (1)'; alonso='14 Alonso (3)';
  leclerc='16 Leclerc (3)'; stroll='18 Stroll (3)'; albon='23 Albon (1)'; hulkenberg="27 H${ue}lkenberg (1)"; max_verstappen='3 Verstappen (1)';
  lawson='30 Lawson (3)'; ocon='31 Ocon (3)'; arvid_lindblad='41 Lindblad (1)'; colapinto='43 Colapinto (1)'; hamilton='44 Hamilton (1)';
  bortoleto='5 Bortoleto (3)'; sainz='55 Sainz (3)'; hadjar='6 Hadjar (1)'; russell='63 Russell (1)'; bottas='77 Bottas (1)';
  piastri='81 Piastri (1)'; bearman='87 Bearman (1)'
}
$teamCars = [ordered]@{ mercedes='russell'; ferrari='leclerc'; mclaren='norris'; red_bull='max_verstappen'; rb='lawson'; alpine='colapinto'; aston_martin='alonso'; williams='sainz'; haas='bearman'; audi='hulkenberg'; cadillac='perez' }

function Strip($s) { if (-not $s) { return '' }; (($s -replace '<[^>]+>', '') -replace '\s+', ' ').Trim() }
function Norm($t) { ($t -replace '^File:', '') -replace '_', ' ' }

function Query($titles, $width, $props) {
  $result = @{}
  for ($i = 0; $i -lt $titles.Count; $i += 40) {
    $chunk = $titles[$i..([Math]::Min($i + 39, $titles.Count - 1))]
    $body = @{ action='query'; format='json'; prop='imageinfo'; iiprop=$props; iiurlwidth=$width; titles=(($chunk | % { "File:$_" }) -join '|') }
    for ($try = 0; $try -lt 5; $try++) {
      try { $r = Invoke-RestMethod -Method Post "https://commons.wikimedia.org/w/api.php" -Body $body -UserAgent $ua; break }
      catch { Write-Host "  warte ($try)…"; Start-Sleep -Seconds (20 * ($try + 1)) }
    }
    # Normalisierte Titel zurück auf die Anfrage abbilden
    $map = @{}; foreach ($n in $r.query.normalized) { $map[$n.to] = $n.from }
    foreach ($p in $r.query.pages.PSObject.Properties.Value) {
      if (-not $p.imageinfo) { Write-Host "  fehlt: $($p.title)"; continue }
      $key = Norm $(if ($map[$p.title]) { $map[$p.title] } else { $p.title })
      $result[$key] = $p.imageinfo[0]
    }
    Start-Sleep -Seconds 3
  }
  return $result
}

# Dateien sammeln
$jol = Invoke-RestMethod "https://api.jolpi.ca/ergast/f1/current/driverStandings.json"
$drivers = $jol.MRData.StandingsTable.StandingsLists[0].DriverStandings
$sched = (Invoke-RestMethod "https://api.jolpi.ca/ergast/f1/current.json?limit=100").MRData.RaceTable.Races

$want = @{}   # key -> Dateiname
foreach ($id in $driverCars.Keys) { $want["car:$id"] = "$prefix$($driverCars[$id]).jpg" }

function LeadFile($url) {
  $title = [uri]::UnescapeDataString(($url -split '/wiki/')[1])
  try {
    $s = Invoke-RestMethod ("https://en.wikipedia.org/api/rest_v1/page/summary/" + [uri]::EscapeDataString($title)) -UserAgent $ua
    Start-Sleep -Milliseconds 300
    if (-not $s.originalimage.source) { return $null }
    return ([uri]::UnescapeDataString((($s.originalimage.source -split '\?')[0] -split '/')[-1]) -replace '_', ' ')
  } catch { return $null }
}
foreach ($d in $drivers) { $f = LeadFile $d.Driver.url; if ($f) { $want["drv:$($d.Driver.driverId)"] = $f } }
foreach ($r in $sched) { $f = LeadFile $r.Circuit.url; if ($f) { $want["cir:$($r.Circuit.circuitId)"] = $f } }
Write-Host "Dateien: $($want.Count)"

$files = @($want.Values | Sort-Object -Unique)
$small = Query $files 800 'url|extmetadata|size'
$big = Query $files 1920 'url'

function Entry($file) {
  $k = Norm $file
  $ii = $small[$k]; if (-not $ii) { return $null }
  $m = $ii.extmetadata
  $large = if ($big[$k]) { $big[$k].thumburl } else { $ii.thumburl }
  return [ordered]@{ src = $ii.thumburl; large = $large; file = $ii.descriptionurl; credit = (Strip $m.Artist.value); license = (Strip $m.LicenseShortName.value); w = $ii.width; h = $ii.height; curated = $true }
}

$media = [ordered]@{ drivers = [ordered]@{}; driverCars = [ordered]@{}; cars = [ordered]@{}; circuits = [ordered]@{} }
foreach ($k in $want.Keys) {
  $e = Entry $want[$k]
  if (-not $e) { Write-Host "  ohne Bild: $k"; continue }
  $kind, $id = $k -split ':', 2
  switch ($kind) { 'car' { $media.driverCars[$id] = $e } 'drv' { $media.drivers[$id] = $e } 'cir' { $media.circuits[$id] = $e } }
}
foreach ($t in $teamCars.Keys) { if ($media.driverCars[$teamCars[$t]]) { $media.cars[$t] = $media.driverCars[$teamCars[$t]] } }
$json = $media | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path (Get-Location) "f1-hub\data\media.json"), $json, (New-Object Text.UTF8Encoding $false))
Write-Host "fertig: $($media.driverCars.Count) Autos, $($media.drivers.Count) Portraits, $($media.circuits.Count) Strecken"
