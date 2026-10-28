sub init()
    m.poster = m.top.findNode("poster")
    m.name = m.top.findNode("name")
end sub

sub onContent()
    item = m.top.itemContent
    if item = invalid then return
    m.poster.uri = item.HDPosterUrl
    m.name.text = item.title
end sub
