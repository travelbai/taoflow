@echo off
chcp 65001 >nul 2>&1
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"
echo [%date% %time%] START >> "%SCRIPT_DIR%scraper.log" 2>&1
where py >nul 2>&1
if not errorlevel 1 (
  py -3 -u "%SCRIPT_DIR%news_scraper.py" >> "%SCRIPT_DIR%scraper.log" 2>&1
) else (
  where python >nul 2>&1
  if errorlevel 1 (
    echo Python 3 not found. Install Python 3 and run: python -m pip install -r requirements.txt >> "%SCRIPT_DIR%scraper.log" 2>&1
    exit /b 9009
  )
  python -u "%SCRIPT_DIR%news_scraper.py" >> "%SCRIPT_DIR%scraper.log" 2>&1
)
set "SCRAPER_EXIT=%errorlevel%"
echo [%date% %time%] END exit=%SCRAPER_EXIT% >> "%SCRIPT_DIR%scraper.log" 2>&1
exit /b %SCRAPER_EXIT%
