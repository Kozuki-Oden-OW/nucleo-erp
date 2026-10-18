#!/usr/bin/env python3
"""Arma el video final a partir de la grabación cruda.

Uso: post.py <nombre> <num> "<título|línea 2>" "<subtítulo>" "<siguiente>" <archivo-salida-sin-extensión>
Produce en out/: <salida>.mp4 (limpio), <salida> - GUIA.mp4 (con el texto a leer), <salida>.srt y <salida> - guion.txt
"""
import json, subprocess, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
INTRO, OUTRO = 3.5, 8.0

name, num, title, sub, nxt, outname = sys.argv[1:7]
raw = os.path.join(HERE, "raw", name)
out = os.path.join(HERE, "out")
os.makedirs(out, exist_ok=True)
meta = json.load(open(os.path.join(raw, "beats.json")))

def run(*a):
    subprocess.run(a, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

subprocess.run(["node", os.path.join(HERE, "cards.cjs"), raw, num, title, sub, nxt], check=True)

enc = ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30",
       "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2"]
sil = ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]

body = os.path.join(raw, "body.mp4")
run("ffmpeg", "-y", "-ss", f"{meta['offset']:.3f}", "-i", os.path.join(raw, "raw.mkv"), *sil,
    "-t", f"{meta['total']:.3f}", "-map", "0:v", "-map", "1:a", "-shortest", *enc, body)
intro = os.path.join(raw, "intro.mp4")
run("ffmpeg", "-y", "-loop", "1", "-i", os.path.join(raw, "intro.png"), *sil, "-t", str(INTRO),
    "-vf", f"fade=in:st=0:d=0.4,fade=out:st={INTRO-0.5}:d=0.5", "-map", "0:v", "-map", "1:a", *enc, intro)
outro = os.path.join(raw, "outro.mp4")
run("ffmpeg", "-y", "-loop", "1", "-i", os.path.join(raw, "outro.png"), *sil, "-t", str(OUTRO),
    "-vf", "fade=in:st=0:d=0.5", "-map", "0:v", "-map", "1:a", *enc, outro)

lst = os.path.join(raw, "list.txt")
open(lst, "w").write("".join(f"file '{p}'\n" for p in (intro, body, outro)))
final = os.path.join(out, outname + ".mp4")
run("ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", "-movflags", "+faststart", final)

def ts(t):
    ms = int(round(t * 1000)); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"

beats = meta["beats"]
srt = []
for i, b in enumerate(beats, 1):
    end = b["end"] - 0.15
    srt.append(f"{i}\n{ts(b['start'] + INTRO)} --> {ts(end + INTRO)}\n{b['text']}\n")
os.makedirs(os.path.join(out, "subtitulos"), exist_ok=True)
srt_path = os.path.join(out, "subtitulos", outname + ".srt")
open(srt_path, "w", encoding="utf-8").write("\n".join(srt))

# Guion con tiempos, para leer mientras se graba la voz.
txt = [f"{num} · {title.replace('|', ' ')}", f"Duración total: {ts(INTRO + meta['total'] + OUTRO)[3:8]}", ""]
for i, b in enumerate(beats, 1):
    txt.append(f"[{ts(b['start'] + INTRO)[3:8]}]  {b['text']}")
open(os.path.join(out, outname + " - guion.txt"), "w", encoding="utf-8").write("\n".join(txt) + "\n")

# Versión guía: el texto a leer aparece abajo en grande en el momento justo.
style = ("FontName=Inter,FontSize=15,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,"
         "BackColour=&H30280F00,BorderStyle=4,Outline=0,Shadow=0,MarginV=28,MarginL=60,MarginR=60,Alignment=2,Bold=1")
guia = os.path.join(out, outname + " - GUIA.mp4")
fonts = HERE
srt_esc = srt_path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
run("ffmpeg", "-y", "-i", final, "-vf", f"subtitles='{srt_esc}':fontsdir='{fonts}':force_style='{style}'",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-c:a", "copy", "-movflags", "+faststart", guia)
print("OK", final)
