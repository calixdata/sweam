' SweamTV for Roku: the lean-back channel for AI-generated binge series and
' films. Everything lives in the AppScene SceneGraph component; this entry
' point only opens the screen and keeps the event loop alive.
sub Main()
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)
    screen.CreateScene("AppScene")
    screen.Show()
    while true
        msg = wait(0, port)
        if type(msg) = "roSGScreenEvent"
            if msg.IsScreenClosed() then return
        end if
    end while
end sub
