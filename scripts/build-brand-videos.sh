#!/usr/bin/env bash
# Rebuild the four bundled 8-second Mizanora playback cards.
# Requires ffmpeg (with libx264/AAC) and ImageMagick convert + DejaVu fonts.
set -euo pipefail
cd "$(dirname "$0")/.."
FFMPEG=${FFMPEG:-ffmpeg}
command -v "$FFMPEG" >/dev/null || { echo 'ffmpeg is required' >&2; exit 1; }
command -v convert >/dev/null || { echo 'ImageMagick convert is required' >&2; exit 1; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
convert public/assets/img/brand/miznaoraiptv-logo.png -fuzz 8% -transparent black -resize 300x300 "$tmp/logo.png"

for kind in welcome channel-offline pro-unlock coming-soon; do
  case "$kind" in
    welcome)
      badge='WELCOME / LIVE TV'; title='WELCOME TO'; headline='MIZANORA IPTV'; subtitle='Your channel is loading. Please wait.'; banner='LIVE TV  •  MOVIES  •  SERIES'; accent='#42d29a' ;;
    channel-offline)
      badge='LIVE CHANNEL / STATUS'; title='CHANNEL'; headline='OFFLINE'; subtitle='The stream is unavailable right now.'; banner='PLEASE RETRY IN A FEW MOMENTS'; accent='#e9ad63' ;;
    pro-unlock)
      badge='SUBSCRIPTION / RECHARGE'; title='RECHARGE'; headline='YOUR ACCOUNT'; subtitle='Contact support to renew your subscription.'; banner='WHATSAPP SUPPORT IS HERE TO HELP'; accent='#e6c472' ;;
    coming-soon)
      badge='MIZANORA / CINEMA'; title='MOVIES & SERIES'; headline='COMING SOON'; subtitle='Our cinema library is being prepared.'; banner='MORE ENTERTAINMENT IS ON THE WAY'; accent='#42d29a' ;;
  esac
  mkdir -p "$tmp/$kind"
  # Draw at 1280x720 with generous TV-safe margins and a transparent logo.
  convert -size 1280x720 gradient:'#07110f-#12362c' \
    -fill '#122e27' -stroke '#365a46' -strokewidth 1 -draw 'roundrectangle 36,36 1244,684 28,28' \
    -fill '#091b17' -stroke '#285345' -draw 'roundrectangle 54,55 1226,665 22,22' \
    -fill "$accent" -stroke none -draw 'roundrectangle 82,75 89,125 3,3' \
    -font DejaVu-Sans-Bold -fill '#f7df9b' -pointsize 21 -annotate +109+96 'MIZANORA IPTV' \
    -font DejaVu-Sans -fill '#9ab8a8' -pointsize 15 -annotate +109+119 'PREMIUM ENTERTAINMENT' \
    -fill '#213d32' -stroke '#446d54' -draw 'roundrectangle 90,181 390,217 18,18' \
    -font DejaVu-Sans-Bold -fill "$accent" -stroke none -pointsize 14 -annotate +109+205 "$badge" \
    -fill '#fbf7e9' -pointsize 49 -annotate +88+296 "$title" \
    -fill '#f0ca70' -pointsize 61 -annotate +88+373 "$headline" \
    -font DejaVu-Sans -fill '#c5dbcf' -pointsize 22 -annotate +90+426 "$subtitle" \
    -fill '#153b2e' -stroke '#326a50' -draw 'roundrectangle 88,470 700,526 12,12' \
    -fill "$accent" -stroke none -font DejaVu-Sans-Bold -pointsize 17 -annotate +110+505 "$banner" \
    -fill '#1e4334' -draw 'roundrectangle 88,551 700,555 2,2' \
    -fill '#819f90' -font DejaVu-Sans -pointsize 17 -annotate +90+607 'WHATSAPP SUPPORT' \
    -fill '#f3d284' -font DejaVu-Sans-Bold -pointsize 23 -annotate +90+639 '0306-2015326' \
    -stroke '#355f4c' -strokewidth 1 -fill none -draw 'circle 1000,341 1162,341' -draw 'circle 1000,341 1137,341' \
    "$tmp/logo.png" -geometry +850+191 -composite "$tmp/$kind/frame.png"

  # A small animated light travels across the progress track. The ambient audio
  # is synthesized here, rather than carrying branding from the old videos.
  "$FFMPEG" -hide_banner -loglevel error -y \
    -loop 1 -framerate 25 -i "$tmp/$kind/frame.png" \
    -f lavfi -i "color=c=$accent:s=18x4:r=25" \
    -f lavfi -i 'aevalsrc=0.020*(sin(2*PI*174*t)+0.6*sin(2*PI*220*t)+0.35*sin(2*PI*261.63*t)):s=48000:d=8' \
    -filter_complex "[0:v][1:v]overlay=x='88+594*t/8':y=551:shortest=1,format=yuv420p[v];[2:a]afade=t=in:st=0:d=0.5,afade=t=out:st=7.5:d=0.5,aformat=channel_layouts=stereo[a]" \
    -map '[v]' -map '[a]' -t 8 -c:v libx264 -preset medium -crf 23 -profile:v main -g 50 -keyint_min 50 -sc_threshold 0 \
    -c:a aac -b:a 96k -movflags +faststart "$tmp/$kind/video.mp4"
  "$FFMPEG" -hide_banner -loglevel error -y -i "$tmp/$kind/video.mp4" -c copy \
    -hls_time 2 -hls_list_size 0 -hls_playlist_type vod -hls_flags independent_segments \
    -hls_segment_filename "$tmp/$kind/seg%d.m2ts" "$tmp/$kind/index.m3u8"
  # Fail before replacing any media if the expected two-second segments are missing.
  shopt -s nullglob
  segments=("$tmp/$kind/seg"*.m2ts)
  [[ ${#segments[@]} -eq 4 ]] || { echo "Expected four HLS segments for $kind" >&2; exit 1; }
  for segment in "${segments[@]}"; do
    "$FFMPEG" -hide_banner -loglevel error -i "$segment" -f null -
  done
  "$FFMPEG" -hide_banner -loglevel error -i "$tmp/$kind/video.mp4" -f null -
done

for kind in welcome channel-offline pro-unlock coming-soon; do
  cp "$tmp/$kind/video.mp4" "$tmp/$kind/index.m3u8" "$tmp/$kind/seg"*.m2ts "public/media/$kind/"
done
echo 'Mizanora branded videos and HLS playlists updated.'
