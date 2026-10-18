"""Re-encode the dsh-dafeiyu frame manifest into transparent VP9 clips.

The frames derive from PC2005-cloud/dsh-pet character assets, which are
non-commercial and require credit to https://github.com/PC2005-cloud/dsh-pet
(see packs/whaletail-maid/UPSTREAM_ASSET_TERMS.md). The dsh-dafeiyu MIT notice
covers code; it does not relicense those assets.

Usage: python3 tools/import-motion.py /path/to/dsh-dafeiyu
Requires ffmpeg with libvpx-vp9. The clips listed in the dsh-dafeiyu manifest are
overwritten deterministically; clips with a source kind (dsh-pet webm, AI video,
or a pack sheet), the categories, chain weights, event tiers, click areas, and the
recorded upstream baseline (upstreamBaseline) are kept from the existing motion.json.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

source = Path(sys.argv[1]).resolve()
pack = Path(__file__).resolve().parents[1] / 'packs' / 'whaletail-maid'
manifest = json.loads((source / 'assets/pet-manifest.json').read_text(encoding='utf-8'))
output = pack / 'assets/motion'
output.mkdir(parents=True, exist_ok=True)
existing = json.loads((pack / 'motion.json').read_text(encoding='utf-8')) if (pack / 'motion.json').exists() else {}
# Clips with a source kind belong to other import tools (dsh-pet webm, AI video) or ship as pack sheets.
clips = {name: clip for name, clip in existing.get('clips', {}).items() if clip.get('source', {}).get('kind') is not None}
for name, clip in manifest['clips'].items():
    frames = clip['frames']
    # The upstream clips use consecutive, one-indexed filenames.
    first = source / 'assets/pet' / frames[0]
    pattern = str(first).replace('_001.webp', '_%03d.webp')
    destination = output / f'{name}.webm'
    subprocess.run([
        'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-framerate', f"1000/{clip['frameMs']}",
        '-i', pattern, '-frames:v', str(len(frames)),
        '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0',
        '-b:v', '0', '-crf', '18', '-deadline', 'good', '-cpu-used', '4',
        '-threads', '2', '-an', str(destination),
    ], check=True)
    if name in clips:
        raise SystemExit(f'{name} belongs to another import tool')
    clips[name] = {
        'file': f'assets/motion/{name}.webm', 'loop': clip['loop'],
        'durationMs': len(frames) * clip['frameMs'], 'frames': len(frames),
        'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
        'source': clip['source'],
    }
    print(name, destination.stat().st_size, flush=True)
record = {
    'formatVersion': 2, 'renderer': 'vp9-alpha', 'width': manifest['maxFrameWidth'], 'height': manifest['maxFrameHeight'],
    'repository': 'https://github.com/qcytsn/dsh-dafeiyu',
    'revision': subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip(),
    'upstream': manifest['assetSource'],
    **({'upstreamBaseline': existing['upstreamBaseline']} if 'upstreamBaseline' in existing else {}),
    'clips': clips,
    **{key: existing[key] for key in ('categories', 'chain', 'events', 'clicks') if key in existing},
}
(pack / 'motion.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(pack / 'MOTION_LICENSE.txt').write_bytes((source / 'assets/dsh-pet-LICENSE.txt').read_bytes())
