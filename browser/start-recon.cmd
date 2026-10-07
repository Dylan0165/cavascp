@echo off
REM ---------------------------------------------------------------------------
REM  Start de verkenning van Portflow.
REM
REM  Er opent een Chrome-venster. Log daarin in met je Fontys-account
REM  (inclusief 2FA). Dat doe jij; dit script ziet je wachtwoord nooit.
REM
REM  Daarna gaat het automatisch verder: het opent Portflow en brengt in kaart
REM  hoe de pagina zijn data ophaalt. Sluit het venster niet voortijdig.
REM ---------------------------------------------------------------------------

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is niet gevonden. Installeer het via https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "D:\Dropshippingv0.1tool\.mcp-tools\node_modules\playwright\index.mjs" (
  echo.
  echo   Playwright is niet gevonden op de verwachte plek:
  echo     D:\Dropshippingv0.1tool\.mcp-tools\node_modules\playwright
  echo   Zeg het tegen de assistent; die past config.mjs aan.
  echo.
  pause
  exit /b 1
)

echo.
echo   Er opent zo een Chrome-venster.
echo   Log in met je Fontys-account en laat het venster openstaan.
echo.
echo   Na het inloggen gaat het script verder en sluit daarna vanzelf af.
echo.

node recon.mjs

echo.
echo   Klaar. Het rapport staat in de map out\.
pause
