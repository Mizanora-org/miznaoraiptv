#!/usr/bin/env python3
"""Rebuild Mizanora broadcast cards (8s MP4 + 2s HLS segments).
Requires: pillow, imageio-ffmpeg (or FFMPEG env pointing to ffmpeg).
The website adds the selected channel name/number and live payment settings as
an accessible overlay; these bundled files carry the verified owner defaults.
"""
from __future__ import annotations
import math, os, pathlib, shutil, subprocess, tempfile
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[1]
W, H, FPS, SECONDS = 1280, 720, 25, 8
PAYMENT_METHOD = os.environ.get("MZ_PAYMENT_METHOD", "JazzCash")
PAYMENT_ACCOUNT = os.environ.get("MZ_PAYMENT_ACCOUNT", "0306-2015326")
PAYMENT_TITLE = os.environ.get("MZ_PAYMENT_TITLE", "Muaaz Iqbal")
SUPPORT = os.environ.get("MZ_SUPPORT_NUMBER", "0306-2015326")
FONT_DIR = pathlib.Path("/usr/share/fonts/truetype/dejavu")
def font(size, bold=False):
    path = FONT_DIR / ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf")
    return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default()

def ffmpeg() -> str:
    if os.environ.get("FFMPEG"): return os.environ["FFMPEG"]
    found = shutil.which("ffmpeg")
    if found: return found
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError as exc:
        raise SystemExit("Install ffmpeg or `pip install imageio-ffmpeg pillow` before rebuilding videos.") from exc

FFMPEG = ffmpeg()
CARDS = {
    "welcome": dict(badge="LIVE TV  /  WELCOME", title="MIZANORA IPTV", line="Your channel is starting", sub="LIVE TV  •  MOVIES  •  SERIES", accent=(66,210,154), cta="RESELLER BUSINESS  •  RECHARGE  •  SUPPORT"),
    "channel-offline": dict(badge="CHANNEL STATUS", title="CHANNEL OFFLINE", line="Please retry in a few moments", sub="We are waiting for the broadcast source", accent=(233,173,99), cta="RETRY  •  CONTACT YOUR RESELLER"),
    "pro-unlock": dict(badge="SUBSCRIPTION  /  RECHARGE", title="RECHARGE YOUR ACCOUNT", line="Live TV • Movies • Series", sub="Contact your reseller to renew PRO access", accent=(240,202,112), cta="MIZANORA IPTV RESELLER BUSINESS"),
    "coming-soon": dict(badge="MIZANORA CINEMA", title="MOVIES & SERIES", line="More entertainment is on the way", sub="Licensed titles are being prepared", accent=(66,210,154), cta="MIZANORA IPTV  •  CINEMA UPDATE"),
}

def rounded(draw, box, fill, outline=None, radius=22, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)

def text(draw, xy, value, size, fill, bold=False, anchor=None):
    draw.text(xy, value, font=font(size, bold), fill=fill, anchor=anchor)

def logo_image():
    logo = Image.open(ROOT / "public/assets/img/brand/miznaoraiptv-logo.png").convert("RGBA")
    # The source logo has a black square; make only near-black pixels transparent.
    pixels = logo.load()
    for y in range(logo.height):
        for x in range(logo.width):
            r,g,b,a = pixels[x,y]
            if max(r,g,b) < 28: pixels[x,y] = (r,g,b,0)
    return logo.resize((250,250), Image.Resampling.LANCZOS)
LOGO = logo_image()

def background(t, accent):
    im = Image.new("RGB", (W,H), (4,15,12))
    d = ImageDraw.Draw(im)
    for y in range(H):
        k = y/H
        d.line([(0,y),(W,y)], fill=(int(4+8*k), int(18+24*k), int(14+16*k)))
    glow = Image.new("RGBA",(W,H),(0,0,0,0)); gd = ImageDraw.Draw(glow)
    cx = 980 + int(45*math.sin(t*0.8)); cy = 250 + int(30*math.cos(t*0.7))
    for r in range(340, 20, -12):
        alpha = int(2 + 16*(1-r/340))
        gd.ellipse((cx-r,cy-r,cx+r,cy+r), fill=(*accent,alpha))
    glow = glow.filter(ImageFilter.GaussianBlur(28)); im = Image.alpha_composite(im.convert("RGBA"), glow)
    d = ImageDraw.Draw(im)
    for x in range(0,W,64): d.line([(x,0),(x,H)], fill=(255,255,255,7), width=1)
    for y in range(0,H,64): d.line([(0,y),(W,y)], fill=(255,255,255,7), width=1)
    # Traveling gold particles.
    for i in range(26):
        x = (i*173 + int(t*(18+i%5*7))) % (W+80) - 40
        y = (i*97 + int(22*math.sin(t+i))) % H
        r = 1 + i%3
        d.ellipse((x-r,y-r,x+r,y+r), fill=(245,196,81,90))
    return im

def frame(card, t):
    accent = card["accent"]
    im = background(t, accent)
    d = ImageDraw.Draw(im)
    rounded(d,(34,34,1246,686),(5,20,15,170),(54,92,70,220),30,2)
    rounded(d,(56,56,1224,664),(6,24,18,150),(35,70,52,180),24,1)
    # Brand header.
    d.rounded_rectangle((82,76,90,126),radius=4,fill=accent)
    text(d,(108,94),"MIZANORA IPTV",22,(247,223,155,255),True)
    text(d,(108,122),"PREMIUM ENTERTAINMENT  •  MIZANORA PROJECTS",13,(154,184,168,255))
    # Animated badge and title entrance.
    ease = min(1.0, t/0.7); offset = int((1-ease)*26)
    rounded(d,(88,176+offset,560,214+offset),(20,52,40,230),(*accent,180),19,1)
    text(d,(108,195+offset),card["badge"],14,(*accent,255),True,anchor="lm")
    text(d,(88,278+offset),card["title"],48 if len(card["title"])<22 else 40,(251,247,233,255),True)
    text(d,(90,340+offset),card["line"],24,(197,219,207,255))
    text(d,(90,378+offset),card["sub"],17,(143,184,166,255))
    rounded(d,(88,424,720,474),(16,48,36,235),(*accent,130),12,1)
    text(d,(108,449),card["cta"],15,(*accent,255),True,anchor="lm")
    # Payment / business card.
    rounded(d,(88,502,720,636),(10,34,25,240),(64,106,80,220),16,1)
    text(d,(108,526),"RECHARGE / PAYMENT",13,(143,184,168,255),True)
    text(d,(108,558),f"{PAYMENT_METHOD}  •  {PAYMENT_ACCOUNT}",22,(243,210,132,255),True)
    text(d,(108,592),f"Account title: {PAYMENT_TITLE}   |   WhatsApp {SUPPORT}",15,(197,219,207,255))
    # Logo with animated orbit rings.
    cx,cy=1000,318
    for i in range(3):
        r=145+i*24+int(8*math.sin(t*2+i))
        alpha=110-i*28
        d.ellipse((cx-r,cy-r,cx+r,cy+r),outline=(*accent,alpha),width=2)
    angle=t*1.4
    for i in range(3):
        a=angle+i*2*math.pi/3; x=cx+int(178*math.cos(a)); y=cy+int(178*math.sin(a))
        d.ellipse((x-5,y-5,x+5,y+5),fill=(245,196,81,230))
    bob=int(6*math.sin(t*1.8))
    im.alpha_composite(LOGO,(875,193+bob))
    text(d,(1000,505),"MIZANORA",20,(247,223,155,255),True,anchor="mm")
    text(d,(1000,535),"IPTV SERVICE",14,(154,184,168,255),anchor="mm")
    # Eight-second progress track.
    rounded(d,(88,650,1192,656),(30,61,46,255),radius=3)
    progress=max(0,min(1,t/SECONDS))
    if progress>0: rounded(d,(88,650,88+int(1104*progress),656),(*accent,255),radius=3)
    return im.convert("RGB")

def run(args): subprocess.run(args,check=True)

def build(kind, card, tmp):
    out = pathlib.Path(tmp)/kind; out.mkdir(parents=True,exist_ok=True)
    mp4 = out/"video.mp4"
    video = subprocess.Popen([FFMPEG,"-hide_banner","-loglevel","error","-y","-f","rawvideo","-pix_fmt","rgb24","-s",f"{W}x{H}","-r",str(FPS),"-i","-","-an","-c:v","libx264","-preset","medium","-crf","21","-profile:v","main","-pix_fmt","yuv420p","-g","50","-keyint_min","50","-sc_threshold","0","-movflags","+faststart",str(mp4)],stdin=subprocess.PIPE)
    for i in range(FPS*SECONDS):
        video.stdin.write(frame(card,i/FPS).tobytes())
        if i==FPS*2: frame(card,i/FPS).save(out/"poster.jpg",quality=90)
    video.stdin.close()
    if video.wait()!=0: raise RuntimeError(f"Video encode failed for {kind}")
    audio = out/"audio.m4a"
    run([FFMPEG,"-hide_banner","-loglevel","error","-y","-f","lavfi","-i","aevalsrc=0.018*(sin(2*PI*174*t)+0.6*sin(2*PI*220*t)+0.35*sin(2*PI*261.63*t)):s=48000:d=8","-af","afade=t=in:st=0:d=0.6,afade=t=out:st=7.4:d=0.6","-c:a","aac","-b:a","96k",str(audio)])
    final = out/"final.mp4"
    run([FFMPEG,"-hide_banner","-loglevel","error","-y","-i",str(mp4),"-i",str(audio),"-c:v","copy","-c:a","copy","-shortest","-movflags","+faststart",str(final)])
    final.replace(mp4)
    run([FFMPEG,"-hide_banner","-loglevel","error","-y","-i",str(mp4),"-c","copy","-hls_time","2","-hls_list_size","0","-hls_playlist_type","vod","-hls_flags","independent_segments","-hls_segment_filename",str(out/"seg%d.m2ts"),str(out/"index.m3u8")])
    segments=sorted(out.glob("seg*.m2ts"))
    if len(segments)!=4: raise RuntimeError(f"Expected 4 HLS segments for {kind}, got {len(segments)}")
    for seg in segments: run([FFMPEG,"-hide_banner","-loglevel","error","-i",str(seg),"-f","null","-"])
    run([FFMPEG,"-hide_banner","-loglevel","error","-i",str(mp4),"-f","null","-"])
    return out

def main():
    with tempfile.TemporaryDirectory(prefix="mizanora-media-") as tmp:
        built={kind:build(kind,card,tmp) for kind,card in CARDS.items()}
        for kind,out in built.items():
            dest=ROOT/"public/media"/kind; dest.mkdir(parents=True,exist_ok=True)
            # Remove only the known generated card files, never user uploads.
            for old in dest.glob("seg*.m2ts"): old.unlink()
            for name in ["video.mp4","index.m3u8","poster.jpg",*[p.name for p in out.glob("seg*.m2ts")]]:
                shutil.copy2(out/name,dest/name)
    print("Rebuilt Mizanora welcome, offline, recharge and cinema cards: 8s MP4 + HLS + posters.")
if __name__=="__main__": main()
