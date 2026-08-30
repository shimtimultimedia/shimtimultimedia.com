' ---------------------------------------------------------------------------
'  Starts dev-server-keepalive.cmd with no console window.
'
'  A shortcut to this file lives in the user's Startup folder, so the dev server
'  comes back on its own after a reboot or a sleep, without a black cmd window
'  sitting on the desktop for the rest of the day.
'
'  Task Scheduler would be the tidier home for this, but registering a task
'  needs administrator rights and this does not.
' ---------------------------------------------------------------------------

Dim shell, here
Set shell = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

' 0 = hidden window, False = do not wait for it to finish.
shell.Run """" & here & "dev-server-keepalive.cmd""", 0, False
