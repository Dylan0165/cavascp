@echo off
REM ---------------------------------------------------------------------------
REM  Start het cavascp dashboard.
REM
REM  Dubbelklik dit bestand, of draai het vanuit elke map: het zet zelf de
REM  juiste werkmap, zodat `node server.mjs` niet stukloopt op een verkeerde
REM  directory.
REM
REM  Bewust alleen ASCII: cmd.exe leest .cmd-bestanden met de codepage van de
REM  console, en vakjes-tekens zoals kaderlijnen worden dan als commando
REM  uitgevoerd ("is not recognized as an internal or external command").
REM ---------------------------------------------------------------------------

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is niet gevonden op deze computer.
  echo   Installeer het via https://nodejs.org en probeer opnieuw.
  echo.
  pause
  exit /b 1
)

echo.
echo   Dashboard start op http://127.0.0.1:8787
echo   Laat dit venster openstaan; sluiten stopt de server.
echo.

start "" http://127.0.0.1:8787/
node server.mjs

echo.
echo   Server gestopt.
pause
