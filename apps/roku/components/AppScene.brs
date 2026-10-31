' SweamTV for Roku: pair with a short code, browse the AI-originals feed,
' play HLS/MP4 with the device session as a Bearer header (captions ride the
' watch payload as a sideloaded track), send the same watch-progress beacons
' as the website so resume follows the account, and take deep links straight
' into playback.

sub init()
    m.BASE = "https://sweam.co"

    m.pairGroup = m.top.findNode("pairGroup")
    m.pairCode = m.top.findNode("pairCode")
    m.pairSteps = m.top.findNode("pairSteps")
    m.pairStatus = m.top.findNode("pairStatus")
    m.homeGroup = m.top.findNode("homeGroup")
    m.homeWho = m.top.findNode("homeWho")
    m.rows = m.top.findNode("rows")
    m.detailGroup = m.top.findNode("detailGroup")
    m.detailPoster = m.top.findNode("detailPoster")
    m.detailName = m.top.findNode("detailName")
    m.detailMeta = m.top.findNode("detailMeta")
    m.detailSynopsis = m.top.findNode("detailSynopsis")
    m.detailComing = m.top.findNode("detailComing")
    m.episodeList = m.top.findNode("episodeList")
    m.videoGroup = m.top.findNode("videoGroup")
    m.video = m.top.findNode("video")
    m.globalStatus = m.top.findNode("globalStatus")
    m.pollTimer = m.top.findNode("pollTimer")

    m.rows.observeField("rowItemSelected", "onRowItemSelected")
    m.episodeList.observeField("itemSelected", "onEpisodeSelected")
    m.pollTimer.observeField("fire", "onPollTick")
    m.video.observeField("state", "onVideoState")
    m.video.observeField("position", "onVideoPosition")
    m.top.observeField("deepLink", "onDeepLink")

    m.tasks = []
    m.feedRows = invalid
    m.detail = invalid
    m.detailEpisodeIds = []
    m.watch = invalid
    m.nextEpisodeId = ""
    m.pairCodeValue = ""
    m.pairRetry = false
    m.homeRetry = false
    m.pendingSeek = 0
    m.lastBeaconS = 0
    m.sessionOk = false
    m.pendingDeepLink = ""

    m.token = regRead("token")
    m.deviceId = regRead("device")

    if m.token <> ""
        api("GET", "/api/tv/session?device=" + m.deviceId, invalid, true, "onSession")
    else
        startPairing()
    end if
end sub

' --------------------------------------------------------------------------
' Registry
' --------------------------------------------------------------------------

function regRead(key as string) as string
    section = CreateObject("roRegistrySection", "sweamtv")
    if section.Exists(key) then return section.Read(key)
    return ""
end function

sub regWrite(key as string, value as string)
    section = CreateObject("roRegistrySection", "sweamtv")
    section.Write(key, value)
    section.Flush()
end sub

' --------------------------------------------------------------------------
' HTTP plumbing: one ApiTask per call, dispatched by the task's id.
' --------------------------------------------------------------------------

sub api(method as string, path as string, body as object, withAuth as boolean, callback as string)
    task = CreateObject("roSGNode", "ApiTask")
    task.method = method
    task.url = m.BASE + path
    if body <> invalid
        task.body = FormatJson(body)
    end if
    if withAuth then task.token = m.token
    task.id = callback
    task.observeField("done", "onApiDone")
    m.tasks.Push(task)
    task.control = "RUN"
end sub

sub onApiDone(event as object)
    task = event.getRoSGNode()
    callback = task.id
    status = task.status
    response = task.response

    remaining = []
    for each t in m.tasks
        if not t.isSameNode(task) then remaining.Push(t)
    end for
    m.tasks = remaining

    if callback = "onSession"
        handleSession(status, response)
    else if callback = "onPairStart"
        handlePairStart(status, response)
    else if callback = "onPairPoll"
        handlePairPoll(status, response)
    else if callback = "onFeed"
        handleFeed(status, response)
    else if callback = "onTitle"
        handleTitle(status, response)
    else if callback = "onWatch"
        handleWatch(status, response)
    end if
    ' onBeacon needs no handling.
end sub

function absUrl(url as dynamic) as string
    if url = invalid then return ""
    if Left(url, 4) = "http" then return url
    return m.BASE + url
end function

function numStr(value as dynamic) as string
    if value = invalid then return ""
    return StrI(Int(value)).Trim()
end function

' --------------------------------------------------------------------------
' Boot + pairing
' --------------------------------------------------------------------------

sub handleSession(status as integer, response as object)
    if status = 200
        who = ""
        if response.user <> invalid and response.user.username <> invalid and response.user.username <> ""
            who = "Watching as @" + response.user.username
        end if
        m.homeWho.text = who
        m.sessionOk = true
        loadFeed()
        applyDeepLink()
    else
        m.token = ""
        regWrite("token", "")
        startPairing()
    end if
end sub

sub startPairing()
    showGroup("pair")
    m.sessionOk = false
    m.pairRetry = false
    m.pairCode.text = ""
    m.pairSteps.text = ""
    m.pairStatus.text = "Getting your pairing code..."
    api("POST", "/api/tv/pair/start", { platform: "roku" }, false, "onPairStart")
end sub

sub handlePairStart(status as integer, response as object)
    if status <> 201 or response.code = invalid
        m.pairStatus.text = "Could not reach Sweam. Press OK to try again."
        m.pairRetry = true
        return
    end if
    m.deviceId = response.deviceId
    m.pairCodeValue = response.code
    regWrite("device", m.deviceId)
    m.pairCode.text = response.code
    m.pairSteps.text = "1. On your phone, go to sweam.co/activate" + chr(10) + "2. Sign in to Sweam (accounts are free)" + chr(10) + "3. Enter the code above"
    m.pairStatus.text = "Waiting for the code... this screen continues by itself."
    m.pollTimer.control = "start"
end sub

sub onPollTick()
    if m.pairCodeValue = "" then return
    api("POST", "/api/tv/pair/poll", { deviceId: m.deviceId, code: m.pairCodeValue }, false, "onPairPoll")
end sub

sub handlePairPoll(status as integer, response as object)
    if response.status = invalid then return
    if response.status = "paired"
        m.pollTimer.control = "stop"
        m.pairCodeValue = ""
        m.token = response.token
        regWrite("token", m.token)
        who = ""
        if response.user <> invalid and response.user.username <> invalid and response.user.username <> ""
            who = "Watching as @" + response.user.username
        end if
        m.homeWho.text = who
        m.sessionOk = true
        loadFeed()
        applyDeepLink()
    else if response.status = "expired"
        m.pollTimer.control = "stop"
        m.pairCodeValue = ""
        m.pairStatus.text = "That code expired. Press OK for a new code."
        m.pairRetry = true
    end if
end sub

' --------------------------------------------------------------------------
' Home feed
' --------------------------------------------------------------------------

sub loadFeed()
    showGroup("home")
    m.homeRetry = false
    m.globalStatus.text = "Loading the channel..."
    api("GET", "/api/tv/feed", invalid, false, "onFeed")
end sub

sub handleFeed(status as integer, response as object)
    m.globalStatus.text = ""
    if status <> 200 or response.rows = invalid
        m.globalStatus.text = "Could not load the channel. Press OK to retry."
        m.homeRetry = true
        return
    end if
    m.feedRows = response.rows
    content = CreateObject("roSGNode", "ContentNode")
    for each row in response.rows
        rowNode = content.CreateChild("ContentNode")
        rowNode.title = row.name
        for each t in row.titles
            item = rowNode.CreateChild("ContentNode")
            item.title = t.name
            if t.posterUrl <> invalid and t.posterUrl <> ""
                item.HDPosterUrl = absUrl(t.posterUrl)
            end if
        end for
    end for
    m.rows.content = content
    ' A deep link may already be playing on top of home: leave focus alone.
    if m.homeGroup.visible then m.rows.setFocus(true)
end sub

sub onRowItemSelected()
    sel = m.rows.rowItemSelected
    if sel = invalid or sel.Count() < 2 then return
    if m.feedRows = invalid then return
    row = m.feedRows[sel[0]]
    if row = invalid then return
    t = row.titles[sel[1]]
    if t = invalid then return
    openTitle(t.slug)
end sub

' --------------------------------------------------------------------------
' Title detail
' --------------------------------------------------------------------------

sub openTitle(slug as string)
    m.globalStatus.text = "Loading..."
    api("GET", "/api/titles/" + slug, invalid, false, "onTitle")
end sub

sub handleTitle(status as integer, response as object)
    m.globalStatus.text = ""
    if status <> 200 or response.episodes = invalid
        m.globalStatus.text = "Could not load that title."
        return
    end if
    m.detail = response
    showGroup("detail")
    m.detailPoster.uri = absUrl(response.posterUrl)
    m.detailName.text = response.name
    meta = response.kind + "  -  " + response.genre
    if response.advisory <> invalid then meta = meta + "  -  " + response.advisory
    m.detailMeta.text = meta + "  -  AI original"
    m.detailSynopsis.text = response.synopsis

    m.detailEpisodeIds = []
    content = CreateObject("roSGNode", "ContentNode")
    coming = ""
    for each ep in response.episodes
        label = "S" + numStr(ep.season) + " E" + numStr(ep.episode) + "   " + ep.name
        released = (ep.released = true and ep.videoUrl <> invalid and ep.videoUrl <> "")
        if released
            item = content.CreateChild("ContentNode")
            item.title = label
            m.detailEpisodeIds.Push(ep.id)
        else
            line = label
            if ep.releaseAt <> invalid and ep.releaseAt <> ""
                line = line + "  (releases " + Left(ep.releaseAt, 10) + ")"
            else
                line = line + "  (coming soon)"
            end if
            if coming <> "" then coming = coming + chr(10)
            coming = coming + line
        end if
    end for
    m.detailComing.text = coming
    m.episodeList.content = content
    if m.detailEpisodeIds.Count() > 0
        m.episodeList.setFocus(true)
    end if
end sub

sub onEpisodeSelected()
    idx = m.episodeList.itemSelected
    if idx < 0 or idx >= m.detailEpisodeIds.Count() then return
    openEpisode(m.detailEpisodeIds[idx])
end sub

' --------------------------------------------------------------------------
' Playback + progress beacons
' --------------------------------------------------------------------------

sub openEpisode(episodeId as string)
    m.globalStatus.text = "Loading episode..."
    api("GET", "/api/watch/" + episodeId, invalid, true, "onWatch")
end sub

sub handleWatch(status as integer, response as object)
    m.globalStatus.text = ""
    if status = 401
        ' The session was revoked (unpaired from Settings): pair again. A
        ' pending deep link survives the re-pair and plays once paired.
        m.token = ""
        regWrite("token", "")
        startPairing()
        return
    end if
    m.pendingDeepLink = ""
    if status <> 200 or response.episode = invalid or response.episode.videoUrl = invalid or response.episode.videoUrl = ""
        m.globalStatus.text = "That episode is not available yet."
        return
    end if
    m.watch = response
    m.nextEpisodeId = ""
    if response.nextEpisode <> invalid and response.nextEpisode.id <> invalid
        m.nextEpisodeId = response.nextEpisode.id
    end if

    showGroup("video")
    content = CreateObject("roSGNode", "ContentNode")
    url = absUrl(response.episode.videoUrl)
    content.url = url
    content.title = response.title.name + "  " + response.episode.name
    if Right(url, 5) = ".m3u8"
        content.streamformat = "hls"
    else
        content.streamformat = "mp4"
    end if
    content.HttpCertificatesFile = "common:/certs/ca-bundle.crt"
    content.HttpHeaders = ["Authorization: Bearer " + m.token]

    ' Captions. In-stream HLS text tracks surface on their own; the sidecar
    ' file from the watch payload is added as a sideloaded track and selected
    ' below so the OS renders it whenever the viewer's system caption setting
    ' asks for captions. The channel never writes globalCaptionMode: that
    ' setting belongs to the viewer.
    capUrl = ""
    if response.episode.captionsUrl <> invalid and response.episode.captionsUrl <> ""
        capUrl = absUrl(response.episode.captionsUrl)
        content.SubtitleTracks = [{ Language: "eng", Description: "English", TrackName: capUrl }]
    end if

    m.pendingSeek = 0
    if response.positionS <> invalid and response.positionS > 5
        m.pendingSeek = Int(response.positionS)
    end if
    m.lastBeaconS = 0
    m.video.content = content
    ' An empty capUrl clears any selection left by the previous episode, so
    ' in-stream tracks go back to the OS's own language-based pick.
    m.video.subtitleTrack = capUrl
    m.video.setFocus(true)
    m.video.control = "play"
end sub

sub onVideoPosition()
    pos = m.video.position
    if pos - m.lastBeaconS >= 10
        m.lastBeaconS = pos
        sendBeacon(pos)
    end if
end sub

sub sendBeacon(positionS as dynamic)
    if m.watch = invalid then return
    dur = m.video.duration
    if dur = invalid or dur <= 0 then return
    body = { positionS: Int(positionS), durationS: Int(dur) }
    api("POST", "/api/watch/" + m.watch.episode.id + "/progress", body, true, "onBeacon")
end sub

sub onVideoState()
    state = m.video.state
    if state = "playing" and m.pendingSeek > 0
        m.video.seek = m.pendingSeek
        m.pendingSeek = 0
    else if state = "finished"
        sendBeacon(m.video.duration)
        if m.nextEpisodeId <> ""
            openEpisode(m.nextEpisodeId)
        else
            closeVideo()
        end if
    else if state = "error"
        m.globalStatus.text = "Playback error. Press Back and try again."
        closeVideo()
    end if
end sub

sub closeVideo()
    m.video.control = "stop"
    m.video.content = invalid
    m.watch = invalid
    if m.detail <> invalid
        showGroup("detail")
        if m.detailEpisodeIds.Count() > 0 then m.episodeList.setFocus(true)
    else
        ' Deep-linked playback has no detail screen behind it: go home.
        showGroup("home")
        if m.rows.content <> invalid then m.rows.setFocus(true)
    end if
end sub

' --------------------------------------------------------------------------
' Deep linking (Roku Search, ads, ECP input): contentId is an episode id for
' both supported mediaTypes — "episode" plays that episode, "series" enters
' the series at that episode and the watch payload's resume position and
' next-episode chaining take it from there. A link that arrives before the
' session is confirmed (cold launch, or mid-pairing) waits in
' m.pendingDeepLink and plays right after; an unplayable contentId lands on
' the home screen with a message, per Roku's certification rules.
' --------------------------------------------------------------------------

sub onDeepLink()
    dl = m.top.deepLink
    if dl = invalid then return
    if not isNonEmptyString(dl.contentId) or not isNonEmptyString(dl.mediaType) then return
    mediaType = LCase(dl.mediaType)
    if mediaType <> "episode" and mediaType <> "series" then return
    m.pendingDeepLink = dl.contentId
    if m.sessionOk then applyDeepLink()
end sub

sub applyDeepLink()
    if m.pendingDeepLink = "" then return
    if m.videoGroup.visible
        sendBeacon(m.video.position)
        m.video.control = "stop"
        m.video.content = invalid
        m.watch = invalid
    end if
    ' Home sits behind the playback, so Back and any failure message land
    ' somewhere sensible; stale detail state is dropped for the same reason.
    m.detail = invalid
    m.detailEpisodeIds = []
    showGroup("home")
    if m.rows.content <> invalid then m.rows.setFocus(true)
    ' The pending id stays set until the watch response: a 401 re-pairs and
    ' then retries it, any other response consumes it (see handleWatch).
    openEpisode(m.pendingDeepLink)
end sub

function isNonEmptyString(value as dynamic) as boolean
    if type(value) <> "String" and type(value) <> "roString" then return false
    return value <> ""
end function

' --------------------------------------------------------------------------
' Navigation
' --------------------------------------------------------------------------

sub showGroup(name as string)
    m.pairGroup.visible = (name = "pair")
    m.homeGroup.visible = (name = "home")
    m.detailGroup.visible = (name = "detail")
    m.videoGroup.visible = (name = "video")
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    if not press then return false
    if key = "back"
        if m.videoGroup.visible
            sendBeacon(m.video.position)
            closeVideo()
            return true
        else if m.detailGroup.visible
            showGroup("home")
            m.rows.setFocus(true)
            return true
        end if
        return false
    end if
    if key = "OK"
        if m.pairGroup.visible and m.pairRetry
            startPairing()
            return true
        end if
        if m.homeGroup.visible and m.homeRetry
            loadFeed()
            return true
        end if
    end if
    return false
end function
