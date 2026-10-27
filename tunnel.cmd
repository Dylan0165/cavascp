@echo off
REM
REM Het dashboard op de mini-pc openen, vanaf deze Windows-machine.
REM
REM Er wordt een SSH-tunnel opgezet naar 127.0.0.1:8787 op de mini-pc. Het
REM dashboard luistert daar alleen op localhost, dus zonder deze tunnel komt
REM niemand erbij. De tunnel maakt het bereikbaar op DEZE machine, en nergens
REM anders.
REM
REM Laat dit venster openstaan zolang je het dashboard gebruikt.
REM

set DOEL=ubuntu@100.96.31.24
set POORT=8787

echo.
echo   Tunnel openen naar het dashboard op de mini-pc...
echo.

REM Eerst kijken of de poort al bezet is door iets anders.
netstat -an | findstr ":%POORT% " | findstr LISTENING >nul 2>&1
if %ERRORLEVEL% EQU 0 (
  echo   Poort %POORT% is al in gebruik op deze machine.
  echo   Misschien draait het dashboard hier al lokaal, of er is nog een oude tunnel.
  echo   Sluit dat eerst af, of open http://127.0.0.1:%POORT%/ en kijk of het werkt.
  echo.
  pause
  exit /b 1
)

start "" http://127.0.0.1:%POORT%/
ssh -N -o ExitOnForwardFailure=yes -L %POORT%:127.0.0.1:%POORT% %DOEL%

echo.
echo   Tunnel gesloten.
pause
