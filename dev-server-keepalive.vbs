' ---------------------------------------------------------------------------
'  Starts dev-server-keepalive.cmd with no console window.
'
'  Shortcuts to this file live in the user's Startup folder - one per site - so
'  the servers come back on their own after a reboot or a sleep, without black
'  cmd windows sitting on the desktop for the rest of the day.
'
'  Any arguments are passed straight through to the .cmd, so a shortcut can say
'  which port and which checkout it is for.
'
'  Task Scheduler would be the tidier home for this, but registering a task
'  needs administrator rights and this does not.
' ---------------------------------------------------------------------------

Dim shell, here, args, i, cmd
Set shell = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

cmd = """" & here & "dev-server-keepalive.cmd"""
Set args = WScript.Arguments
For i = 0 To args.Count - 1
  cmd = cmd & " """ & args(i) & """"
Next

' 0 = hidden window, False = do not wait for it to finish.
shell.Run cmd, 0, False
