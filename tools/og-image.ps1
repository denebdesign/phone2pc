# public/og-image.png (1200x630) 을 다시 만든다.
#   powershell -ExecutionPolicy Bypass -File tools/og-image.ps1
# 카카오톡·슬랙·X 공유 카드에 쓰이는 이미지라 문구를 바꾸면 다시 돌려야 한다.

Add-Type -AssemblyName System.Drawing

$W = 1200; $H = 630
$out = Join-Path $PSScriptRoot '..\public\og-image.png'

$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

function New-RoundedPath($x, $y, $w, $h, $r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# --- 배경: 사이트와 같은 보라 그라데이션 ---
$rect = New-Object System.Drawing.Rectangle(0, 0, $W, $H)
$c1 = [System.Drawing.Color]::FromArgb(76, 47, 224)
$c2 = [System.Drawing.Color]::FromArgb(124, 58, 237)
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 35.0)
$g.FillRectangle($bg, $rect)

# --- 안쪽 카드 ---
$card = New-RoundedPath 56 56 1088 518 40
$g.FillPath((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(26, 255, 255, 255))), $card)
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(72, 255, 255, 255), 2)
$g.DrawPath($pen, $card)

$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$soft  = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(240, 255, 255, 255))
$glass = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(90, 255, 255, 255))
$ink   = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 88, 60, 226))

$center = New-Object System.Drawing.StringFormat
$center.Alignment = [System.Drawing.StringAlignment]::Center
$center.LineAlignment = [System.Drawing.StringAlignment]::Center

# --- Phone2PC ---
$fTitle = New-Object System.Drawing.Font('Segoe UI', 82, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString('Phone2PC', $fTitle, $white, (New-Object System.Drawing.RectangleF(0, 150, $W, 100)), $center)

# --- 폰 ---
$phone = New-RoundedPath 312 245 110 190 18
$g.FillPath($soft, $phone)
$screen = New-RoundedPath 322 258 90 164 10
$g.FillPath($ink, $screen)
$g.FillPath($glass, (New-RoundedPath 352 428 30 4 2))

# --- 화살표 ---
$arrowPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(230, 255, 255, 255), 9)
$arrowPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($arrowPen, 467, 340, 565, 340)
$head = New-Object System.Drawing.Drawing2D.GraphicsPath
$head.AddPolygon(@(
  (New-Object System.Drawing.Point(587, 340)),
  (New-Object System.Drawing.Point(557, 322)),
  (New-Object System.Drawing.Point(557, 358))
))
$g.FillPath((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(230, 255, 255, 255))), $head)

# --- 노트북 ---
$lid = New-RoundedPath 627 252 240 156 14
$g.FillPath($soft, $lid)
$lidScreen = New-RoundedPath 639 264 216 132 8
$g.FillPath($ink, $lidScreen)
$base = New-RoundedPath 605 414 284 18 9
$g.FillPath($soft, $base)

# --- Phone to PC. Simply. ---
$fTag = New-Object System.Drawing.Font('Segoe UI', 44, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$tagBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(245, 255, 255, 255))
$g.DrawString('Phone to PC. Simply.', $fTag, $tagBrush, (New-Object System.Drawing.RectangleF(0, 468, $W, 60)), $center)

$g.Dispose()
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "saved: $((Resolve-Path $out).Path)"
