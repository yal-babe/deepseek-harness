"""Re-encode the MIT frame manifest from dsh-dafeiyu into transparent VP9 clips.

Usage: python3 tools/import-motion.py /path/to/dsh-dafeiyu
Requires ffmpeg with libvpx-vp9. Existing clips are overwritten deterministically.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

source = Path(sys.argv[1]).resolve()
pack = Path(__file__).resolve().parents[1] / 'packs' / 'whaletail-maid'
manifest = json.loads((source / 'assets/pet-manifest.json').read_text())
output = pack / 'assets/motion'
output.mkdir(parents=True, exist_ok=True)
existing = json.loads((pack / 'motion.json').read_text()) if (pack / 'motion.json').exists() else {}
clips = {name: clip for name, clip in existing.get('clips', {}).items() if clip.get('source', {}).get('kind') == 'generated'}
for name, clip in manifest['clips'].items():
    frames = clip['frames']
    # The upstream clips use consecutive, one-indexed filenames.
    first = source / 'assets/pet' / frames[0]
    pattern = str(first).replace('_001.webp', '_%03d.webp')
    destination = output / f'{name}.webm'
    subprocess.run([
        'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-framerate', '500/21',
        '-i', pattern, '-frames:v', str(len(frames)), '-vf', 'scale=206:172',
        '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0',
        '-b:v', '0', '-crf', '32', '-deadline', 'good', '-cpu-used', '4',
        '-threads', '2', '-an', str(destination),
    ], check=True)
    clips[name] = {
        'file': f'assets/motion/{name}.webm', 'loop': clip['loop'],
        'durationMs': len(frames) * clip['frameMs'], 'frames': len(frames),
        'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
        'source': clip['source'],
    }
    print(name, destination.stat().st_size, flush=True)
record = {
    'formatVersion': 1, 'renderer': 'vp9-alpha', 'width': 206, 'height': 172,
    'repository': 'https://github.com/qcytsn/dsh-dafeiyu',
    'revision': subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip(),
    'upstream': manifest['assetSource'], 'clips': clips,
}
(pack / 'motion.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
(pack / 'MOTION_LICENSE.txt').write_bytes((source / 'assets/dsh-pet-LICENSE.txt').read_bytes())
