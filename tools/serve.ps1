# Kleiner lokaler Webserver fuer die Vorschau (ohne Node.js).
# Start im Projektordner: powershell -ExecutionPolicy Bypass -File tools\serve.ps1
# Danach im Browser: http://localhost:8899/
param([string]$Root = (Split-Path $PSScriptRoot -Parent), [int]$Port = 8899)
$Root = [IO.Path]::GetFullPath($Root)
$types = @{ '.html'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.mjs'='text/javascript; charset=utf-8'; '.json'='application/json; charset=utf-8'; '.sql'='text/plain; charset=utf-8'; '.md'='text/plain; charset=utf-8'; '.svg'='image/svg+xml'; '.png'='image/png'; '.ico'='image/x-icon'; '.webmanifest'='application/manifest+json'; '.ics'='text/calendar'; '.xml'='application/xml' }
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "Pitwall laeuft auf http://localhost:$Port/  (Ordner: $Root)"
while ($l.IsListening) {
  $ctx = $l.GetContext()
  $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
  if ($path -eq '' -or $path.EndsWith('/')) { $path += 'index.html' }
  $file = Join-Path $Root $path
  try {
    if ((Test-Path $file -PathType Leaf) -and ([IO.Path]::GetFullPath($file).StartsWith($Root))) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $ctx.Response.ContentType = $(if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' })
      $ctx.Response.Headers.Add('Cache-Control', 'no-store')
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else { $ctx.Response.StatusCode = 404 }
  } catch { $ctx.Response.StatusCode = 500 }
  $ctx.Response.Close()
}
