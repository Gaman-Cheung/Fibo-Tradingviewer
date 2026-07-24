$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
if (-not (Test-Path "$root\node_modules")) { npm.cmd install }
Start-Process "http://127.0.0.1:4173/TradingViewer.html"
npm.cmd run start
