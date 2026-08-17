# start-dev.ps1
# Run QB-WMS DEV server on port 9997

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "   QB-WMS DEV SERVIDOR (PUERTO 9997)                      " -ForegroundColor Green
Write-Host "   IP LAN: http://192.168.2.222:9997/                     " -ForegroundColor Green
Write-Host "   Local:  http://localhost:9997/                         " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green

$env:PORT = "9997"
$env:HOST = "0.0.0.0"
node server.js
