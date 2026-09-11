# ===================================================================
# 37 게임 - 테스트용 로컬 웹 서버
#   http://localhost:8037/ 로 프로젝트 폴더를 제공한다.
#   Firebase 익명 로그인은 file:// 에서 동작하지 않고 localhost 는 기본 허용이라,
#   실제 Firebase 를 쓰는 테스트(test/mp-live.html)는 이 서버로 연다.
#   POST /report 로 받은 본문을 -Report 파일에 저장한다 (테스트 결과 수거용).
#
#   사용: powershell -File test/serve.ps1 [-Port 8037] [-Seconds 600]
# ===================================================================
param(
  [int]$Port = 8037,
  [string]$Root = (Split-Path $PSScriptRoot -Parent),
  [string]$Report = (Join-Path $env:TEMP 'sj37-report.json'),
  [int]$Seconds = 600
)

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'application/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8';  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'; '.svg' = 'image/svg+xml'
}
# localhost 는 IPv6(::1)로 먼저 붙는 경우가 많아 두 루프백 주소를 모두 연다
$listeners = @(
  [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port),
  [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::IPv6Loopback, $Port)
)
$listeners | ForEach-Object { $_.Start() }
Write-Output "serving $Root on http://localhost:$Port/ (report -> $Report)"
$deadline = (Get-Date).AddSeconds($Seconds)

function Send($stream, [int]$code, [string]$type, [byte[]]$body){
  $status = @{ 200 = 'OK'; 404 = 'Not Found'; 204 = 'No Content' }[$code]
  $head = "HTTP/1.1 $code $status`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`n" +
          "Cache-Control: no-store`r`nConnection: close`r`n`r`n"
  $hb = [Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length)
  if ($body.Length) { $stream.Write($body, 0, $body.Length) }
}

while ((Get-Date) -lt $deadline) {
  $ready = $listeners | Where-Object { $_.Pending() } | Select-Object -First 1
  if (-not $ready) { Start-Sleep -Milliseconds 15; continue }
  $client = $ready.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    # 본문은 테스트 페이지가 ASCII(\uXXXX 이스케이프)로 보내므로 ASCII 로 읽어도 안전하다
    $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 65536, $true)
    $line = $reader.ReadLine()
    if (-not $line) { continue }
    $headers = @{}
    while ($true) {
      $h = $reader.ReadLine()
      if ([string]::IsNullOrEmpty($h)) { break }
      $i = $h.IndexOf(':'); if ($i -gt 0) { $headers[$h.Substring(0, $i).Trim().ToLower()] = $h.Substring($i + 1).Trim() }
    }
    $method, $target = $line.Split(' ')[0, 1]
    $path = [Uri]::UnescapeDataString(($target -split '\?')[0])

    if ($method -eq 'POST' -and $path -eq '/report') {
      $len = [int]$headers['content-length']
      $buf = New-Object char[] $len; $read = 0
      while ($read -lt $len) { $n = $reader.Read($buf, $read, $len - $read); if ($n -le 0) { break }; $read += $n }
      [IO.File]::WriteAllText($Report, (-join $buf[0..($read - 1)]))
      Send $stream 204 'text/plain' ([byte[]]@())
      continue
    }
    if ($path -eq '/') { $path = '/index.html' }
    $file = Join-Path $Root ($path.TrimStart('/') -replace '/', '\')
    $full = [IO.Path]::GetFullPath($file)
    if ($full.StartsWith([IO.Path]::GetFullPath($Root)) -and (Test-Path $full -PathType Leaf)) {
      $ext = [IO.Path]::GetExtension($full).ToLower()
      $type = if ($mime[$ext]) { $mime[$ext] } else { 'application/octet-stream' }
      Send $stream 200 $type ([IO.File]::ReadAllBytes($full))
    } else {
      Send $stream 404 'text/plain' ([Text.Encoding]::ASCII.GetBytes('not found'))
    }
  } catch {
  } finally { $client.Close() }
}
$listeners | ForEach-Object { $_.Stop() }
