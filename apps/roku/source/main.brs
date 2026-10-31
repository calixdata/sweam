' SweamTV for Roku: the lean-back channel for AI-generated binge series and
' films. Everything lives in the AppScene SceneGraph component; this entry
' point opens the screen, hands deep links to the scene (launch args here,
' runtime roInput events in the loop), and keeps the event loop alive.
sub Main(args as dynamic)
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)
    scene = screen.CreateScene("AppScene")
    screen.Show()

    ' Deep links sent while the channel is already running arrive as roInput
    ' events on the same port (manifest: supports_input_launch=1).
    input = CreateObject("roInput")
    input.SetMessagePort(port)

    sendDeepLink(scene, args)

    while true
        msg = wait(0, port)
        msgType = type(msg)
        if msgType = "roSGScreenEvent"
            if msg.IsScreenClosed() then return
        else if msgType = "roInputEvent"
            if msg.IsInput() then sendDeepLink(scene, msg.GetInfo())
        end if
    end while
end sub

' Launch args and roInput info share one shape: contentId + mediaType
' (SweamTV uses episode ids as contentId for both mediaTypes). The scene
' validates the pair and falls back to the home screen when it cannot play.
sub sendDeepLink(scene as object, info as dynamic)
    if type(info) <> "roAssociativeArray" then return
    if info.contentId = invalid or info.mediaType = invalid then return
    scene.deepLink = { contentId: info.contentId, mediaType: info.mediaType }
end sub
