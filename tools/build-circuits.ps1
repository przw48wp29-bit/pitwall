# Ergänzt media.json um Streckenkarten (SVG von Commons) und fehlende Porträts.
$ua = "PitwallCurator/1.0 (private fan site)"
$override = @{ monza = 'Monza track map.svg'; red_bull_ring = 'Spielberg bare map numbers contextless 2016 onwards.svg'; miami = 'Formula1 Circuit Miami Hard Rock Stadium.svg'; sepang = 'Circuit Sepang.svg' }
function Strip($s) { if (-not $s) { return '' }; (($s -replace '<[^>]+>', '') -replace '\s+', ' ').Trim() }
function Norm($t) { ($t -replace '^File:', '') -replace '_', ' ' }
function CleanName($src) {
  $n = [uri]::UnescapeDataString((($src -split '\?')[0] -split '/')[-1]) -replace '_', ' '
  $n = $n -replace '^\d+px-', ''
  if ($n -match '\.svg\.png$') { $n = $n -replace '\.png$', '' }
  return $n
}
function LeadFile($url) {
  $title = [uri]::UnescapeDataString(($url -split '/wiki/')[1])
  try {
    $s = Invoke-RestMethod ("https://en.wikipedia.org/api/rest_v1/page/summary/" + [uri]::EscapeDataString($title)) -UserAgent $ua
    Start-Sleep -Milliseconds 300
    if (-not $s.originalimage.source) { return $null }
    return CleanName $s.originalimage.source
  } catch { return $null }
}
function Query($titles, $width, $props) {
  $result = @{}
  $body = @{ action='query'; format='json'; prop='imageinfo'; iiprop=$props; iiurlwidth=$width; titles=(($titles | % { "File:$_" }) -join '|') }
  for ($try = 0; $try -lt 5; $try++) {
    try { $r = Invoke-RestMethod -Method Post "https://commons.wikimedia.org/w/api.php" -Body $body -UserAgent $ua; break }
    catch { Start-Sleep -Seconds (20 * ($try + 1)) }
  }
  $map = @{}; foreach ($n in $r.query.normalized) { $map[$n.to] = $n.from }
  foreach ($p in $r.query.pages.PSObject.Properties.Value) {
    if (-not $p.imageinfo) { Write-Host "  fehlt: $($p.title)"; continue }
    $key = Norm $(if ($map[$p.title]) { $map[$p.title] } else { $p.title })
    $result[$key] = $p.imageinfo[0]
  }
  Start-Sleep -Seconds 3
  return $result
}

$path = Join-Path (Get-Location) "f1-hub\data\media.json"
$media = Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json
$sched = (Invoke-RestMethod "https://api.jolpi.ca/ergast/f1/current.json?limit=100").MRData.RaceTable.Races
$want = @{}
foreach ($r in $sched) {
  $cid = $r.Circuit.circuitId
  $f = if ($override[$cid]) { $override[$cid] } else { LeadFile $r.Circuit.url }
  if ($f) { $want["cir:$cid"] = $f }
}
$want['drv:bottas'] = 'Valtteri Bottas at the 2026 Adelaide Motorsport Festival (028A7556).jpg'
$files = @($want.Values | Sort-Object -Unique)
$small = Query $files 800 'url|extmetadata|size'
$big = Query $files 1600 'url'
foreach ($k in $want.Keys) {
  $n = Norm $want[$k]; $ii = $small[$n]
  if (-not $ii) { Write-Host "  ohne Bild: $k ($n)"; continue }
  $m = $ii.extmetadata
  $e = [pscustomobject]@{ src = $ii.thumburl; large = $(if ($big[$n]) { $big[$n].thumburl } else { $ii.thumburl }); file = $ii.descriptionurl; credit = (Strip $m.Artist.value); license = (Strip $m.LicenseShortName.value); w = $ii.width; h = $ii.height; curated = $true }
  $kind, $id = $k -split ':', 2
  $target = if ($kind -eq 'cir') { $media.circuits } else { $media.drivers }
  $target | Add-Member -NotePropertyName $id -NotePropertyValue $e -Force
}
[IO.File]::WriteAllText($path, ($media | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
Write-Host "fertig: $(@($media.circuits.PSObject.Properties).Count) Strecken"
