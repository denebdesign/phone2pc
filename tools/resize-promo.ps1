# public/promo/ 의 상품 사진을 화면에 필요한 크기로 줄인다.
#   powershell -ExecutionPolicy Bypass -File tools/resize-promo.ps1
#
# 썸네일은 PC 74px, 폰 76px로 나간다. 3배 화면(고해상도 폰)까지 또렷하게 보이도록
# 240px을 목표로 한다. 원본은 promo-src/ 로 옮겨 보관한다. 이 폴더는 public/ 밖이라
# 배포에 포함되지 않는다. 이미 작은 파일은 건드리지 않으므로 여러 번 돌려도 안전하다.
#
# 상품 사진을 새로 넣은 뒤 한 번 돌려 주면 된다.

Add-Type -AssemblyName System.Drawing

$MaxSide = 240
$Quality = 82

$promoDir = Join-Path $PSScriptRoot '..\public\promo'
$srcDir = Join-Path $PSScriptRoot '..\promo-src'

if (-not (Test-Path $promoDir)) {
  Write-Output "public/promo 폴더가 없습니다."
  exit 0
}
if (-not (Test-Path $srcDir)) { New-Item -ItemType Directory -Path $srcDir | Out-Null }

$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
  Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1

$totalBefore = 0
$totalAfter = 0

foreach ($file in Get-ChildItem -Path $promoDir -Include *.jpg, *.jpeg, *.png -Recurse) {
  $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
  $stream = New-Object System.IO.MemoryStream(, $bytes)
  $image = [System.Drawing.Image]::FromStream($stream)
  $w = $image.Width
  $h = $image.Height

  if ($w -le $MaxSide -and $h -le $MaxSide) {
    Write-Output ("  건너뜀  {0,-24} {1}x{2} (이미 충분히 작음)" -f $file.Name, $w, $h)
    $image.Dispose(); $stream.Dispose()
    $totalBefore += $file.Length
    $totalAfter += $file.Length
    continue
  }

  $scale = [Math]::Min($MaxSide / $w, $MaxSide / $h)
  $newW = [int][Math]::Round($w * $scale)
  $newH = [int][Math]::Round($h * $scale)

  $canvas = New-Object System.Drawing.Bitmap($newW, $newH)
  $g = [System.Drawing.Graphics]::FromImage($canvas)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

  $attrs = New-Object System.Drawing.Imaging.ImageAttributes
  $attrs.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)   # 가장자리 번짐 방지
  $target = New-Object System.Drawing.Rectangle(0, 0, $newW, $newH)
  $g.DrawImage($image, $target, 0, 0, $w, $h, [System.Drawing.GraphicsUnit]::Pixel, $attrs)

  $g.Dispose()
  $image.Dispose()
  $stream.Dispose()

  # 원본은 지우지 않고 promo-src/ 로 옮겨 둔다
  $keep = Join-Path $srcDir $file.Name
  if (-not (Test-Path $keep)) { [System.IO.File]::WriteAllBytes($keep, $bytes) }

  $params = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
    [System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)
  $canvas.Save($file.FullName, $jpegCodec, $params)
  $canvas.Dispose()

  $after = (Get-Item $file.FullName).Length
  $totalBefore += $bytes.Length
  $totalAfter += $after
  Write-Output ("  줄임    {0,-24} {1}x{2} -> {3}x{4}   {5}KB -> {6}KB" -f `
    $file.Name, $w, $h, $newW, $newH, [int]($bytes.Length / 1KB), [int]($after / 1KB))
}

Write-Output ""
Write-Output ("  합계 {0}KB -> {1}KB" -f [int]($totalBefore / 1KB), [int]($totalAfter / 1KB))
Write-Output ("  원본 보관: {0}" -f (Resolve-Path $srcDir).Path)
