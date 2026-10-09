Add-Type -AssemblyName System.Drawing
foreach ($size in 192, 512) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $s = $size / 512
  $g.Clear([System.Drawing.Color]::FromArgb(255, 21, 21, 30))
  $red = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 225, 6, 0))
  $g.FillRectangle($red, 0, [int](392 * $s), $size, [int](24 * $s))
  $pts = @(@(76,340),@(172,156),@(436,156),@(406,204),@(208,204),@(186,244),@(382,244),@(352,292),@(162,292),@(138,340)) | % { New-Object System.Drawing.PointF ([float]($_[0] * $s)), ([float]($_[1] * $s)) }
  $g.FillPolygon($red, [System.Drawing.PointF[]]$pts)
  $bmp.Save((Join-Path (Get-Location) "f1-hub\assets\icons\icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
"ok"
