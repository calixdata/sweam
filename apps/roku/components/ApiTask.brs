' One HTTPS JSON request per task run. The scene creates a fresh ApiTask for
' every call and reads status + parsed response when done fires.
sub init()
    m.top.functionName = "execute"
end sub

sub execute()
    transfer = CreateObject("roUrlTransfer")
    transfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    transfer.InitClientCertificates()
    transfer.RetainBodyOnError(true)
    transfer.SetUrl(m.top.url)
    transfer.AddHeader("Accept", "application/json")
    if m.top.token <> ""
        transfer.AddHeader("Authorization", "Bearer " + m.top.token)
    end if

    port = CreateObject("roMessagePort")
    transfer.SetMessagePort(port)
    if m.top.method = "POST"
        transfer.AddHeader("Content-Type", "application/json")
        transfer.AsyncPostFromString(m.top.body)
    else
        transfer.AsyncGetToString()
    end if

    status = 0
    body = ""
    msg = wait(30000, port)
    if type(msg) = "roUrlEvent"
        status = msg.GetResponseCode()
        body = msg.GetString()
    end if

    parsed = invalid
    if body <> "" then parsed = ParseJson(body)
    if parsed = invalid then parsed = {}
    m.top.status = status
    m.top.response = parsed
    m.top.done = true
end sub
