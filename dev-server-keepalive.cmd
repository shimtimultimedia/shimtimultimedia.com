@echo off
rem ---------------------------------------------------------------------------
rem  Keeps a local dev server up.
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
rem  Usage:  dev-server-keepalive.cmd [port] [root]
rem    port  defaults to 3201
rem    root  defaults to this directory; pass another checkout to serve it
rem          instead, so the portfolio does not need its own copy of the server.
rem ---------------------------------------------------------------------------

cd /d "%~dp0"

set "PORT=%~1"
if "%PORT%"=="" set "PORT=3201"

set "ROOTARG="
if not "%~2"=="" set "ROOTARG=--root "%~2""

:loop
node dev-server.js --port %PORT% %ROOTARG%
rem Reached only when node exits. Pause so a boot loop cannot spin the CPU.
timeout /t 3 /nobreak >nul
goto loop
