"""Import transparent clips of PC2005-cloud/dsh-pet into the built-in pack, batch by batch.

Adapted for DSH Studio; the upstream assets are non-commercial and require
credit to https://github.com/PC2005-cloud/dsh-pet (packs/whaletail-maid/
UPSTREAM_ASSET_TERMS.md).

Usage: python3 tools/import-dshpet-webm.py /path/to/dsh-pet [recipe.json]

Sources are read from the pinned commit with `git show`, never from the working
tree, so the recorded SHA-256 always matches the recipe commit. Each source is
decoded with libvpx-vp9 (FFmpeg's native VP9 decoder drops alpha), cropped to the
shared window used by the existing clips, and encoded with the settings of
tools/import-motion.py at the source frame rate, muxed bit-exactly so a rerun
reproduces the recorded output hashes.

This tool owns exactly the clips whose source kind is "dsh-pet-webm" and the
top-level "categories" list. It never rewrites clips of other kinds, and the
other import tools preserve what it writes. Clips it imported earlier but no
longer lists are removed together with their media.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

KIND = 'dsh-pet-webm'
ENCODE = ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0',
          '-b:v', '0', '-crf', '18', '-deadline', 'good', '-cpu-used', '4', '-threads', '2', '-an',
          # Bit-exact muxing without metadata makes a rerun byte-identical.
          '-fflags', '+bitexact', '-flags:v', '+bitexact', '-map_metadata', '-1']


def probe(path: Path) -> tuple[int, float, int, int]:
    """Return decoded frame count, frame rate, width, and height."""
    out = subprocess.check_output([
        'ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0',
        '-show_entries', 'stream=nb_read_frames,r_frame_rate,width,height', '-of', 'json', str(path)], text=True)
    stream = json.loads(out)['streams'][0]
    numerator, denominator = stream['r_frame_rate'].split('/')
    rate = int(numerator) / int(denominator)
    return int(stream['nb_read_frames']), int(rate) if rate.is_integer() else rate, int(stream['width']), int(stream['height'])


upstream = Path(sys.argv[1]).resolve()
tools = Path(__file__).resolve().parent
recipe = json.loads(Path(sys.argv[2] if len(sys.argv) > 2 else tools / 'dshpet-webm.recipe.json').read_text(encoding='utf-8'))
pack = tools.parent / 'packs' / 'whaletail-maid'
manifest_path = pack / 'motion.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
commit = subprocess.check_output(['git', '-C', str(upstream), 'rev-parse', recipe['commit'] + '^{commit}'], text=True).strip()
if commit != recipe['commit']:
    raise SystemExit(f'recipe commit must be a full hash, got {recipe["commit"]}')
prompt_bytes = subprocess.check_output(['git', '-C', str(upstream), 'show', f'{commit}:{recipe["generation"]["promptFile"]}'])
prompt_sha = hashlib.sha256(prompt_bytes).hexdigest()
prompt_text = prompt_bytes.decode('utf-8')
x, y, width, height = recipe['crop']
if (width, height) != (manifest['width'], manifest['height']):
    raise SystemExit(f'crop {width}x{height} must match the pack size {manifest["width"]}x{manifest["height"]}')

listed = [entry for batch in recipe['batches'] for entry in batch['clips']]
names = [entry['name'] for entry in listed]
if len(set(names)) != len(names):
    raise SystemExit('a clip name is listed twice')
clips = manifest['clips']
for name, clip in list(clips.items()):
    owned = clip.get('source', {}).get('kind') == KIND
    if name in names and not owned:
        raise SystemExit(f'{name} belongs to another import tool')
    if owned and name not in names:
        (pack / clip['file']).unlink(missing_ok=True)
        del clips[name]

with tempfile.TemporaryDirectory() as scratch:
    for entry in listed:
        if f'## {entry["section"]}\n' not in prompt_text:
            raise SystemExit(f'prompt section {entry["section"]} is missing upstream')
        path = f'{recipe["directory"]}/{entry["source"]}'
        source = Path(scratch) / 'source.webm'
        source.write_bytes(subprocess.check_output(['git', '-C', str(upstream), 'show', f'{commit}:{path}']))
        frames, fps, source_width, source_height = probe(source)
        if x + width > source_width or y + height > source_height:
            raise SystemExit(f'{entry["source"]} is {source_width}x{source_height}; the crop does not fit')
        destination = pack / 'assets' / 'motion' / f'{entry["name"]}.webm'
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-c:v', 'libvpx-vp9', '-i', str(source),
                        '-vf', f'crop={width}:{height}:{x}:{y}', *ENCODE, str(destination)], check=True)
        encoded, _, out_width, out_height = probe(destination)
        if (encoded, out_width, out_height) != (frames, width, height):
            raise SystemExit(f'{entry["name"]}: encoded {encoded} frames at {out_width}x{out_height}')
        clips[entry['name']] = {
            'file': f'assets/motion/{entry["name"]}.webm', 'loop': entry['loop'],
            'durationMs': round(frames * 1000 / fps), 'frames': frames,
            'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
            **({'turn': True} if entry.get('turn') else {}),
            **({'mirror': False} if entry.get('mirror') is False else {}),
            'label': entry['label'],
            'source': {
                'kind': KIND, 'repository': recipe['repository'], 'commit': commit, 'file': path,
                'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'frameCount': frames, 'fps': fps,
                'crop': recipe['crop'],
                'generation': {
                    'tool': recipe['generation']['tool'],
                    'prompt': {'file': recipe['generation']['promptFile'], 'section': entry['section'], 'sha256': prompt_sha},
                    'keying': recipe['generation']['keying'], 'statedIn': recipe['generation']['statedIn'],
                },
            },
        }
        print(entry['name'], destination.stat().st_size, 'bytes', flush=True)

for category in recipe['categories']:
    missing = [name for name in category['clips'] if name not in clips]
    if missing:
        raise SystemExit(f'category {category["id"]} names unknown clips: {missing}')
manifest['formatVersion'] = 2
manifest['categories'] = recipe['categories']
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
