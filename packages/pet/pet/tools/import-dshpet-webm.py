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

Clips with a "move" recipe entry are in-place gaits. Their travel is measured
from the shipped alpha: the feet band (the lowest opaque rows) splits into foot
blobs, each blob is matched to the nearest blob of the next frame, and the mean
shift of the matched blobs is the per-frame travel of the body in the opposite
direction. Frames inside upstream leadSec/tailSec stay still. Moving the body by
exactly that per-frame amount, synchronised with media time, leaves the least
foot slip; the residual slip with and without the travel is recorded. A gait
whose travel is under MIN_TRAVEL_PX, has fewer than MIN_CONTACTS matched
contacts, or whose backward shifts do not outnumber forward ones by
MIN_AGREEMENT plays in place with no "move" record.

This tool owns exactly the clips whose source kind is "dsh-pet-webm" and the
top-level "categories", "chain", "events" (event tiers), and "clicks" (click
responses by body area) entries. It never rewrites clips of other kinds, and the
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


MIN_TRAVEL_PX = 20
MIN_CONTACTS = 40
MIN_AGREEMENT = 2
FEET_BAND_ROWS = 6


def foot_blobs(band: list[bytes]) -> list[tuple[float, int]]:
    """Return (center, width) of opaque column runs in the feet band; gaps of up to 2 columns join."""
    columns = [any(row[x] > 128 for row in band) for x in range(len(band[0]))]
    runs, start, previous = [], None, None
    for x, opaque in enumerate(columns):
        if not opaque:
            continue
        if start is None:
            start = x
        elif x > previous + 2:
            runs.append((start, previous))
            start = x
        previous = x
    if start is not None:
        runs.append((start, previous))
    return [((a + b) / 2, b - a + 1) for a, b in runs if b - a + 1 >= 3]


def measure_travel(path: Path, frames: int, fps: float, lead: float, tail: float, width: int, height: int) -> dict | None:
    """Measure the per-frame travel of an in-place gait; None when it is not measurable."""
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', str(path), '-vf', 'alphaextract',
                                   '-f', 'rawvideo', '-pix_fmt', 'gray', '-'])
    size = width * height
    images = [raw[i * size:(i + 1) * size] for i in range(frames)]
    bottoms = []
    for image in images:
        row = height - 1
        while row > 0 and max(image[row * width:(row + 1) * width]) <= 128:
            row -= 1
        bottoms.append(row)
    feet = sorted(bottoms)[int(len(bottoms) * 0.9)]
    blobs = [foot_blobs([image[r * width:(r + 1) * width] for r in range(feet - FEET_BAND_ROWS + 1, feet + 1)]) for image in images]
    first, last = round(lead * fps), frames - 1 - round(tail * fps)
    steps, shifts = [0.0] * (frames - 1), []
    for t in range(first, last):
        matched = []
        for center, blob_width in blobs[t]:
            nearest = min(blobs[t + 1], key=lambda blob: abs(blob[0] - center), default=None)
            if nearest is not None and abs(nearest[0] - center) <= 6 and abs(nearest[1] - blob_width) <= 4:
                matched.append(nearest[0] - center)
        if matched:
            steps[t] = sum(matched) / len(matched)
            shifts.extend((t, shift) for shift in matched)
    total = sum(steps)
    sign = 1 if total > 0 else -1
    backward = sum(1 for _, shift in shifts if shift * sign >= 0.5)
    forward = sum(1 for _, shift in shifts if shift * sign <= -0.5)
    report = {'contacts': len(shifts), 'travelPx': round(abs(total), 1), 'backward': backward, 'forward': forward}
    if abs(total) < MIN_TRAVEL_PX or len(shifts) < MIN_CONTACTS or backward < MIN_AGREEMENT * max(1, forward):
        print('  not measurable as travel:', report, flush=True)
        return None
    # Cumulative travel in source pixels at each frame start, positive along the travel direction.
    cumulative, travelled = [0.0], 0.0
    for step in steps:
        travelled += step * sign
        cumulative.append(round(travelled, 1))
    in_place = sum(abs(shift) for _, shift in shifts) / len(shifts)
    synced = sum(abs(shift - steps[t]) for t, shift in shifts) / len(shifts)
    return {
        # Blobs shift opposite to the travel: feet sliding right carry the body left.
        'direction': 'left' if total > 0 else 'right',
        'travel': cumulative,
        'leadMs': round(lead * 1000), 'tailMs': round(tail * 1000),
        'slip': {'inPlace': round(in_place, 3), 'synced': round(synced, 3), 'contacts': len(shifts)},
    }


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
        if 'move' in entry:
            move = measure_travel(destination, frames, fps, entry['move']['leadSec'], entry['move']['tailSec'], width, height)
            if move is not None:
                clips[entry['name']]['move'] = {**move, 'statedIn': recipe['moveStatedIn']}
        print(entry['name'], destination.stat().st_size, 'bytes', clips[entry['name']].get('move', {}).get('slip', ''), flush=True)

for category in recipe['categories']:
    missing = [name for name in category['clips'] if name not in clips]
    if missing:
        raise SystemExit(f'category {category["id"]} names unknown clips: {missing}')
for event, tiers in recipe['events'].items():
    if event == 'statedIn':
        continue
    missing = [name for tier in tiers for name in tier if name not in clips]
    if missing:
        raise SystemExit(f'event {event} names unknown clips: {missing}')
for area, names in recipe['clicks'].items():
    if area != 'note' and any(name not in clips for name in names):
        raise SystemExit(f'click area {area} names unknown clips')
manifest['formatVersion'] = 2
manifest['categories'] = recipe['categories']
manifest['chain'] = recipe['chain']
manifest['events'] = recipe['events']
manifest['clicks'] = {area: names for area, names in recipe['clicks'].items() if area != 'note'}
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
