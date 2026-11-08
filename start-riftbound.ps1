$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot
$siteUrl = 'http://127.0.0.1:5173/'
$viteCli = Join-Path $projectDir 'node_modules\vite\bin\vite.js'

function Test-RiftboundPage {
  try {
    $page = Invoke-WebRequest -Uri $siteUrl -UseBasicParsing -TimeoutSec 2
    return $page.StatusCode -eq 200 -and $page.Content.Contains('id="root"') -and $page.Content.Contains('RIFTBOUND')
  } catch {
    return $false
  }
}

if (Test-RiftboundPage) {
  Start-Process $siteUrl
  Write-Host 'RIFTBOUND 도감이 이미 실행 중이어서 브라우저에서 열었습니다.'
  exit 0
}

if (-not (Test-Path $viteCli)) {
  Write-Error '프로젝트 패키지가 설치되어 있지 않습니다. 프로젝트 폴더에서 pnpm install을 먼저 실행해 주세요.'
  exit 1
}

$nodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $nodeExe) {
  # Codex가 제공하는 Node가 있으면 시스템 Node 설치 없이 이 프로젝트를 실행할 수 있습니다.
  $codexRuntimeRoot = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\runtimes\cua_node'
  if (Test-Path $codexRuntimeRoot) {
    $nodeExe = Get-ChildItem -Path $codexRuntimeRoot -Filter node.exe -File -Recurse -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1 -ExpandProperty FullName
  }
}
if (-not $nodeExe) {
  Write-Error 'Node.js를 찾지 못했습니다. Node.js 20 이상과 pnpm을 설치하고 다시 실행해 주세요.'
  exit 1
}

# Vite 콘솔을 열어 두어 사용자가 Ctrl+C로 서버를 종료할 수 있게 합니다.
$viteArgs = '"{0}" --host 127.0.0.1 --strictPort' -f $viteCli
Start-Process -FilePath $nodeExe -ArgumentList $viteArgs -WorkingDirectory $projectDir -WindowStyle Normal

$deadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $deadline) {
  if (Test-RiftboundPage) {
    Start-Process $siteUrl
    Write-Host 'RIFTBOUND 카드 도감을 브라우저에서 열었습니다.'
    exit 0
  }
  Start-Sleep -Seconds 1
}

Write-Error '개발 서버가 45초 안에 준비되지 않았습니다. 열린 서버 창의 오류를 확인해 주세요.'
exit 1
