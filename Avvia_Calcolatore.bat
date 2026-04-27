@echo off
echo ==============================================
echo AVVIO CALCOLATORE PREVENTIVI IN CORSO...
echo ==============================================
echo.
echo Verr aperto il browser in automatico.
echo (Questa finestra serve come server di supporto per leggere i listini, LASCIALA APERTA)
echo.

:: Apri il browser alla pagina locale
start http://localhost:8000

:: Avvia il server con Python 
python -m http.server 8000
