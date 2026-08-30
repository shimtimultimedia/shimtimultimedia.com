@echo off
rem ---------------------------------------------------------------------------
rem  Keeps the local dev server up.
rem
rem  WHY THIS EXISTS
rem
rem  The server used to be started as a child of whatever shell happened to be
rem  running it, which meant it died whenever that shell did - between agent
rem  turns, when the editor closed, and overnight when the machine slept. The
rem  site would then appear to be "down" for reasons that had nothing to do with
rem  the site.
rem
rem  This loop owns the process instead. If node exits for any reason it waits a
rem  moment and starts it again, so a crash costs three seconds rather than a
rem  support question. Launched at logon by dev-server-keepalive.vbs, which runs
rem  it with no console window.
rem
rem  Stop it from Task Manager: end the node.exe serving port 3201, then this
rem  window's cmd.exe - or just remove the Startup shortcut and log out.
rem ---------------------------------------------------------------------------

cd /d "%~dp0"

:loop
node dev-server.js --port 3201
rem Reached only when node exits. Pause so a boot-loop cannot spin the CPU.
timeout /t 3 /nobreak >nul
goto loop
