# MicTek House

Album player for Mikey More Bounce. Hosted on GitHub Pages. Streams public Suno songs without uploading the audio.

## Add a Suno album

1. Open the album on Suno.
2. Paste this in the address bar and hit enter. It copies every song link.

```
javascript:(()=>{const ids=[...new Set([...document.querySelectorAll('a')].map(a=>a.href).filter(h=>/\/song\//.test(h)))];navigator.clipboard.writeText(ids.join('\n'));alert(ids.length+' song links copied')})()
```

3. On the house page, hit From Suno, name the album, paste the links.

Public songs stream from Suno's clip host. If that host blocks a file, the official Suno embed player opens for that track. Private songs will not play.

Direct `cdn1.suno.ai/*.mp3` links are locked. This page uses the public clip stream instead.

Local MP3 drop still works in the browser that dropped them. Those files are not in the GitHub repo.
