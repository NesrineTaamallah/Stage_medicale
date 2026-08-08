@echo off
setlocal
set HF_HUB_DISABLE_XET=1
set HF_HUB_DOWNLOAD_TIMEOUT=120

:retry
echo.
echo === Tentative de telechargement (Ctrl+C pour arreter) ===
C:\Users\nesri\AppData\Roaming\Python\Python313\Scripts\hf.exe download nesrine56/whisper-large-v3-ct2 --cache-dir C:\hf-cache
if errorlevel 1 (
    echo Coupure detectee, nouvelle tentative dans 5 secondes...
    timeout /t 5 /nobreak >nul
    goto retry
)

echo.
echo === Telechargement termine avec succes ===
pause
