# M3U and XMLTV guide

## M3U import

Use **Admin → Channels → M3U channel import** with either:

- local `.m3u` / `.m3u8` text upload; or
- an absolute HTTP(S) URL.

Example:

```m3u
#EXTM3U x-tvg-url="https://example.com/guide.xml"
#EXTINF:-1 tvg-id="news.one" tvg-name="News One" tvg-logo="https://example.com/news.png" group-title="News",News One HD
https://example.com/live/news.m3u8
```

Supported metadata includes `EXTINF`, `EXTGRP`, `tvg-id`, `tvg-name`, `tvg-logo`, `group-title`, `tvg-language`, `tvg-country` and `x-tvg-url`. Relative stream/logo paths in a remote playlist resolve against that playlist URL.

- Upload parser limit: 5 MB / 5,000 channels; Vercel's own request limit may be lower.
- Matching channel IDs update in place; new IDs get unique numeric Xtream stream IDs.
- New channels inherit the selected Free/PRO tier; existing channel tiers are preserved.
- Import history appears under Playlists.
- Optional linked EPG import handles at most two linked sources per M3U import.

## XMLTV import

Use **Admin → EPG Guide** with `.xml` / `.xmltv` text or a remote URL. Remote gzip data is decompressed by the server. Browser `.gz` file upload is not advertised; upload decompressed XML or use its URL.

Common programme fields: title, sub-title, description, category, icon, episode number, date, rating, new and premiere. Standard XML entities and numeric entities are decoded. Programmes with missing/invalid channel, start or stop are skipped.

Limits:

- 8 MB / 30,000 programmes per parsed source;
- 60,000 combined stored programmes;
- authenticated XMLTV output includes a rolling window from 6 hours in the past to 14 days ahead, capped at 12,000 programmes.

These limits prevent a large guide from exhausting serverless memory/storage. Split very large providers into sensible sources or use a smaller guide.

## Channel mapping

Best mapping:

```text
M3U tvg-id = channel epgId = XMLTV programme channel
```

Admin channel rows show the current EPG ID. Exact normalized channel-name matching is a fallback when IDs differ.

## Refresh and output

- Remote sources have a refresh button; uploaded sources must be re-uploaded.
- Deleting a source removes only its channels/programmes.
- Public now/next: `/api/embed?action=guide`.
- Xtream: `get_short_epg` and `get_simple_data_table` with `stream_id`.
- Authenticated XMLTV: `/xmltv.php?username=…&password=…`.
- M3U output advertises the authenticated XMLTV URL through `x-tvg-url`.

Only use playlists, logos, streams and guide data you are authorized to redistribute. Import success does not guarantee upstream playback or content rights.
