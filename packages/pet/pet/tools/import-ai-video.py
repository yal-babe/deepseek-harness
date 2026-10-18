"""Import one AI-generated video clip (green screen or already keyed) into a pet pack.

Usage:
  python3 tools/import-ai-video.py SOURCE --name NAME --tool TOOL (--prompt TEXT | --prompt-file FILE --prompt-section TITLE)
      [--reference IMAGE] [--model MODEL] [--seed SEED] [--date YYYY-MM-DD] [--source-ref REF]
      [--key green|blue|none|0xRRGGBB] [--similarity 0.12] [--blend 0.06] [--despill]
      [--loop] [--turn] [--no-mirror] [--label-zh TEXT --label-en TEXT] [--category ID]
      [--start SECONDS] [--duration SECONDS] [--stand auto|first|last|both|none] [--follow CLIP]
      [--scale FACTOR] [--anchor-clip idle] [--tolerance PX]
      [--pack DIR] [--replace] [--force] [--dry-run]

SOURCE is the generated video, kept outside the pack (only the encoded clip
ships). A green-screen source is keyed with FFmpeg's chromakey (--key green, the
default); a source that already carries alpha (VP9/WebM, ProRes 4444, PNG
frames muxed into MOV) uses --key none.

--stand names the ends that show the standing pose. By default it follows the
name: *_enter and *_start clips stand at the first frame, *_wake, *_exit and
*_stop clips at the last, *_loop clips at neither, and every other clip at both.
A standing end is scaled and placed so that its height, feet line, and
horizontal centre match the first frame of the pack's anchor clip (idle). A
phase that continues another AI-video clip (sleep_loop after sleep_enter) passes
--follow with that clip: it reuses that clip's scale and offset, so the source
videos must share framing, and its first frame must continue the other clip's
last. A clip that stands at neither end needs --follow. The clip is encoded on
the pack canvas (412x344 for whaletail-maid) with the same libvpx-vp9 yuva420p
crf 18 settings as tools/import-dshpet-webm.py. *_loop clips loop even without
--loop.

Before motion.json changes, the encoded clip is decoded again and checked: every
sampled frame has opaque and transparent pixels, nothing touches the canvas
edge, the standing ends stand on the anchor (feet line, centre, height), a
loop's last frame matches its first, a followed clip's last frame matches this
clip's first, and little green spill remains. A failed check removes the output
and changes nothing unless --force is given.

The clip is written as assets/motion/NAME.webm with an "ai-video" source record:
source reference and SHA-256, frame rate, the source window when it lies inside
the source, and the generation record (tool, model, prompt, reference image
SHA-256, seed, date, keying). This tool owns clips of kind "ai-video" only; the
other import tools keep them, and tools/import-dshpet-webm.py keeps the category
memberships added with --category. Clip names that the clients already know
(sleep_enter/sleep_loop/sleep_wake, pillow_*, swim_start/swim_loop/swim_stop,
celebrate, bubbles, play_ball, ...) take effect without code changes; see
AI_VIDEO_CLIPS.zh.md.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

KIND = 'ai-video'
NAME = re.compile(r'^[a-z][a-z0-9_]*$')
ENCODE = ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0',
          '-b:v', '0', '-crf', '18', '-deadline', 'good', '-cpu-used', '4', '-threads', '2', '-an',
          '-fflags', '+bitexact', '-flags:v', '+bitexact', '-map_metadata', '-1']
KEY_COLORS = {'green': '0x00FF00', 'blue': '0x0000FF'}
OPAQUE = 128
SAMPLES = 12


def run(args: list[str]) -> bytes:
    return subprocess.run(args, check=True, capture_output=True).stdout


def probe(path: Path) -> dict:
    """Codec, size, frame rate, and decoded frame count of the first video stream."""
    stream = json.loads(run(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries',
                             'stream=codec_name,width,height,r_frame_rate,nb_read_frames,pix_fmt:stream_tags=alpha_mode',
                             '-of', 'json', str(path)]))['streams'][0]
    numerator, denominator = stream['r_frame_rate'].split('/')
    rate = int(numerator) / int(denominator)
    return {'codec': stream['codec_name'], 'width': int(stream['width']), 'height': int(stream['height']),
            'fps': int(rate) if rate.is_integer() else round(rate, 6), 'frames': int(stream['nb_read_frames'])}


def decoder(info: dict) -> list[str]:
    # FFmpeg's native VP9 decoder drops the alpha plane.
    return ['-c:v', 'libvpx-vp9'] if info['codec'] == 'vp9' else []


def frames_rgba(path: Path, info: dict, width: int, height: int, filters: str = '', pick: str = '') -> list[bytes]:
    """Decode frames as RGBA, optionally through a filter chain and a frame selection expression."""
    chain = ','.join(part for part in [filters, f"select='{pick}'" if pick else '', 'format=rgba'] if part)
    raw = run(['ffmpeg', '-v', 'error', *decoder(info), '-i', str(path), '-vf', chain, '-vsync', '0',
               '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'])
    size = width * height * 4
    return [raw[offset:offset + size] for offset in range(0, len(raw) - size + 1, size)]


def bounds(frame: bytes, width: int, height: int) -> tuple[int, int, int, int] | None:
    """Opaque bounding box (left, top, right, bottom), exclusive at right and bottom."""
    alpha = frame[3::4]
    rows = [y for y in range(height) if max(alpha[y * width:(y + 1) * width]) >= OPAQUE]
    if not rows:
        return None
    columns = [x for x in range(width) if any(alpha[y * width + x] >= OPAQUE for y in range(rows[0], rows[-1] + 1, 2))]
    return columns[0], rows[0], columns[-1] + 1, rows[-1] + 1


def anchor(box: tuple[int, int, int, int]) -> dict:
    left, top, right, bottom = box
    return {'centre': (left + right) / 2, 'feet': bottom, 'height': bottom - top}


def alpha_difference(first: bytes, second: bytes) -> float:
    """Mean absolute alpha difference of two RGBA frames, from 0 to 1."""
    a, b = first[3::4], second[3::4]
    return sum(abs(x - y) for x, y in zip(a, b)) / len(a) / 255


def default_stand(name: str) -> str:
    """Ends of a clip that show the standing pose, from its phase suffix."""
    if name.endswith(('_enter', '_start')):
        return 'first'
    if name.endswith(('_wake', '_exit', '_stop')):
        return 'last'
    return 'none' if name.endswith('_loop') else 'both'


def check_clip(path: Path, canvas: tuple[int, int], reference: dict, ends: tuple[str, ...], loop: bool, tolerance: float,
               preceding: bytes | None = None) -> tuple[list[str], dict]:
    """Decode the encoded clip and return failed checks and measurements.

    ends names the frames ('first', 'last') that must stand on the reference; preceding is the last frame of the
    clip this one follows, which its first frame has to continue.
    """
    width, height = canvas
    info = probe(path)
    count = info['frames']
    picks = sorted({round(index * (count - 1) / (SAMPLES - 1)) for index in range(SAMPLES)})
    frames = frames_rgba(path, info, width, height, pick='+'.join(f'eq(n\\,{n})' for n in picks))
    failures, report = [], {'frames': count, 'sampled': len(frames)}
    if len(frames) != len(picks):
        return [f'decoded {len(frames)} of {len(picks)} sampled frames'], report
    edge = 0
    spill, opaque_total = 0, 0
    for n, frame in zip(picks, frames):
        alpha = frame[3::4]
        if max(alpha) < 250 or min(alpha) > 5:
            failures.append(f'frame {n} lacks opaque or transparent pixels')
        border = [alpha[x] for x in range(width)] + [alpha[(height - 1) * width + x] for x in range(width)]
        border += [alpha[y * width] for y in range(height)] + [alpha[y * width + width - 1] for y in range(height)]
        edge = max(edge, sum(value >= OPAQUE for value in border))
        for offset in range(0, len(frame), 16):
            r, g, b, a = frame[offset:offset + 4]
            if a > 200:
                opaque_total += 1
                spill += g > max(r, b) + 40
    report['edgePixels'] = edge
    if edge > 0:
        failures.append(f'{edge} opaque pixels touch the canvas edge; the character is cut off')
    report['greenSpill'] = round(spill / max(1, opaque_total), 4)
    if report['greenSpill'] > 0.01:
        failures.append(f'green spill on {report["greenSpill"]:.1%} of opaque pixels (limit 1%); try --despill or a larger --similarity')
    for label, frame in (('first', frames[0]), ('last', frames[-1])):
        if label not in ends:
            continue
        box = bounds(frame, width, height)
        if box is None:
            failures.append(f'{label} frame is empty')
            continue
        measured = anchor(box)
        report[label] = measured
        if abs(measured['feet'] - reference['feet']) > tolerance or abs(measured['centre'] - reference['centre']) > tolerance:
            failures.append(f'{label} frame stands off the anchor: feet {measured["feet"]} vs {reference["feet"]}, '
                            f'centre {measured["centre"]:.1f} vs {reference["centre"]:.1f} (tolerance {tolerance} px)')
        if abs(measured['height'] - reference['height']) > reference['height'] * 0.1:
            failures.append(f'{label} frame height {measured["height"]} differs from the anchor {reference["height"]} by more than 10%')
    if loop:
        seam = alpha_difference(frames[0], frames[-1])
        report['loopSeam'] = round(seam, 4)
        if seam > 0.02:
            failures.append(f'loop seam: last frame differs from the first by {seam:.1%} of alpha (limit 2%)')
    if preceding is not None:
        seam = alpha_difference(preceding, frames[0])
        report['phaseSeam'] = round(seam, 4)
        if seam > 0.02:
            failures.append(f'phase seam: first frame differs from the followed clip\'s last by {seam:.1%} of alpha (limit 2%)')
    return failures, report


def keyed_end(source: Path, info: dict, key: str, start: float | None, duration: float | None, end: str) -> bytes | None:
    """The first or last frame of the (trimmed) source after keying, as RGBA."""
    if end == 'first':
        seek = ['-ss', f'{start}'] if start is not None else []
        limit = ['-frames:v', '1']
    elif duration is not None:
        seek = ['-ss', f'{max(start or 0, (start or 0) + duration - 0.5)}', '-t', f'{min(duration, 0.5)}']
        limit = []
    else:
        seek, limit = ['-sseof', '-0.5'], []
    raw = run(['ffmpeg', '-v', 'error', *decoder(info), *seek, '-i', str(source), *limit,
               '-vf', ','.join(part for part in [key, 'format=rgba'] if part), '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'])
    size = info['width'] * info['height'] * 4
    return raw[len(raw) // size * size - size:len(raw) // size * size] if len(raw) >= size else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('source', type=Path)
    parser.add_argument('--name', required=True)
    parser.add_argument('--tool', required=True, help='video generation tool, e.g. Doubao, Kling, Runway')
    parser.add_argument('--prompt')
    parser.add_argument('--prompt-file', type=Path)
    parser.add_argument('--prompt-section')
    parser.add_argument('--reference', type=Path, help='reference image used for generation (only its SHA-256 is recorded)')
    parser.add_argument('--model')
    parser.add_argument('--seed')
    parser.add_argument('--date', default=datetime.date.today().isoformat())
    parser.add_argument('--source-ref', help='how the source is found later; defaults to its file name')
    parser.add_argument('--key', default='green')
    parser.add_argument('--similarity', type=float, default=0.12)
    parser.add_argument('--blend', type=float, default=0.06)
    parser.add_argument('--despill', action='store_true')
    parser.add_argument('--loop', action='store_true')
    parser.add_argument('--turn', action='store_true')
    parser.add_argument('--no-mirror', action='store_true')
    parser.add_argument('--label-zh')
    parser.add_argument('--label-en')
    parser.add_argument('--category')
    parser.add_argument('--start', type=float)
    parser.add_argument('--duration', type=float)
    parser.add_argument('--stand', choices=['auto', 'first', 'last', 'both', 'none'], default='auto',
                        help='ends that show the standing pose; auto follows the name suffix')
    parser.add_argument('--follow', help='AI-video clip this phase continues; reuses its scale and offset')
    parser.add_argument('--scale', type=float, help='fixed scale instead of matching the anchor height')
    parser.add_argument('--anchor-clip', default='idle')
    parser.add_argument('--tolerance', type=float, default=6)
    parser.add_argument('--pack', type=Path, default=Path(__file__).resolve().parent.parent / 'packs' / 'whaletail-maid')
    parser.add_argument('--replace', action='store_true')
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    options = parser.parse_args()

    if not NAME.match(options.name):
        parser.error('--name must be lowercase snake_case')
    if (options.prompt is None) == (options.prompt_file is None) or (options.prompt_file is not None) != (options.prompt_section is not None):
        parser.error('give --prompt, or --prompt-file with --prompt-section')
    if (options.label_zh is None) != (options.label_en is None):
        parser.error('give both --label-zh and --label-en')
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', options.date):
        parser.error('--date must be YYYY-MM-DD')
    pack = options.pack.resolve()
    manifest_path = pack / 'motion.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    clips = manifest['clips']
    existing = clips.get(options.name)
    if existing is not None and existing.get('source', {}).get('kind') != KIND:
        raise SystemExit(f'{options.name} belongs to another import tool; choose another name')
    if existing is not None and not options.replace:
        raise SystemExit(f'{options.name} exists; pass --replace to re-import it')
    categories = manifest.get('categories', [])
    if options.category is not None:
        target = next((category for category in categories if category['id'] == options.category), None)
        if target is None:
            raise SystemExit(f'unknown category {options.category}; existing: {", ".join(c["id"] for c in categories)}')
        elsewhere = [c['id'] for c in categories if c['id'] != options.category and options.name in c['clips']]
        if elsewhere:
            raise SystemExit(f'{options.name} is already in category {elsewhere[0]}')
    stand_mode = default_stand(options.name) if options.stand == 'auto' else options.stand
    ends = {'first': ('first',), 'last': ('last',), 'both': ('first', 'last'), 'none': ()}[stand_mode]
    loop = options.loop or options.name.endswith('_loop')
    followed = None
    if options.follow is not None:
        followed = clips.get(options.follow)
        if followed is None or followed.get('source', {}).get('kind') != KIND or 'normalization' not in followed['source']:
            raise SystemExit(f'--follow {options.follow} must be an AI-video clip of the pack')
    elif not ends:
        raise SystemExit(f'{options.name} stands at neither end (--stand {stand_mode}); pass --follow with the clip it continues')
    width, height = manifest['width'], manifest['height']
    anchor_entry = clips.get(options.anchor_clip)
    if anchor_entry is None or 'sheet' in anchor_entry:
        raise SystemExit(f'anchor clip {options.anchor_clip} must be a video clip of the pack')
    anchor_path = pack / anchor_entry['file']
    anchor_box = bounds(frames_rgba(anchor_path, probe(anchor_path), width, height, pick='eq(n\\,0)')[0], width, height)
    if anchor_box is None:
        raise SystemExit(f'anchor clip {options.anchor_clip} has an empty first frame')
    reference = anchor(anchor_box)

    source = options.source.resolve()
    info = probe(source)
    trim = []
    if options.start is not None:
        trim += ['-ss', f'{options.start}']
    if options.duration is not None:
        trim += ['-t', f'{options.duration}']
    if options.key == 'none':
        key, keying = '', 'source carries alpha'
    else:
        color = KEY_COLORS.get(options.key, options.key)
        if not re.match(r'^0x[0-9A-Fa-f]{6}$', color):
            parser.error('--key must be green, blue, none, or 0xRRGGBB')
        key = f'chromakey={color}:{options.similarity}:{options.blend}'
        keying = f'FFmpeg chromakey {color} similarity {options.similarity} blend {options.blend}'
        if options.despill:
            key += f",despill=type={'blue' if options.key == 'blue' else 'green'}"
            keying += ' with despill'
    if followed is not None:
        normalization = followed['source']['normalization']
        scale = normalization['scale']
        x, y = normalization['offset']
    else:
        stand_end = ends[0]
        stand_frame = keyed_end(source, info, key, options.start, options.duration, stand_end)
        box = bounds(stand_frame, info['width'], info['height']) if stand_frame is not None else None
        if box is None:
            raise SystemExit(f'the keyed {stand_end} frame is empty; check --key and --similarity')
        stand = anchor(box)
        scale = options.scale if options.scale is not None else reference['height'] / stand['height']
        x = round(reference['centre'] - stand['centre'] * scale)
        y = round(reference['feet'] - stand['feet'] * scale)
    scaled_w, scaled_h = max(1, round(info['width'] * scale)), max(1, round(info['height'] * scale))
    # Crop the scaled frame to the visible part of the canvas, then pad it to the canvas with transparency.
    crop_x, crop_y = max(0, -x), max(0, -y)
    crop_w, crop_h = min(scaled_w, width - x) - crop_x, min(scaled_h, height - y) - crop_y
    if crop_w <= 0 or crop_h <= 0:
        raise SystemExit('the normalized character falls outside the canvas')
    chain = ','.join(part for part in [
        key, 'format=rgba', f'scale={scaled_w}:{scaled_h}:flags=lanczos', f'crop={crop_w}:{crop_h}:{crop_x}:{crop_y}',
        f'pad={width}:{height}:{max(0, x)}:{max(0, y)}:color=black@0', 'format=yuva420p'] if part)

    destination = pack / 'assets' / 'motion' / f'{options.name}.webm'
    with tempfile.TemporaryDirectory() as scratch:
        output = Path(scratch) / f'{options.name}.webm'
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *decoder(info), *trim, '-i', str(source),
                        '-vf', chain, *ENCODE, str(output)], check=True)
        encoded = probe(output)
        if (encoded['width'], encoded['height']) != (width, height):
            raise SystemExit(f'encoded {encoded["width"]}x{encoded["height"]}, expected {width}x{height}')
        preceding = None
        if followed is not None:
            followed_path = pack / followed['file']
            followed_info = probe(followed_path)
            tail = frames_rgba(followed_path, followed_info, width, height, pick=f"eq(n\\,{followed_info['frames'] - 1})")
            preceding = tail[0] if tail else None
        failures, report = check_clip(output, (width, height), reference, ends, loop, options.tolerance, preceding)
        report.update({'bytes': output.stat().st_size, 'scale': round(scale, 6), 'offset': [x, y], 'anchor': reference})
        print(json.dumps({'clip': options.name, 'checks': 'failed' if failures else 'passed', 'failures': failures, **report},
                         ensure_ascii=False, indent=2))
        if failures and not options.force:
            print('nothing was written; fix the source or pass --force after reviewing the clip', file=sys.stderr)
            return 1
        if options.dry_run:
            return 0
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(output.read_bytes())

    window = [round(-x / scale), round(-y / scale), round(width / scale), round(height / scale)]
    inside = window[0] >= 0 and window[1] >= 0 and window[0] + window[2] <= info['width'] and window[1] + window[3] <= info['height']
    if options.prompt is not None:
        prompt = {'text': options.prompt}
    else:
        text = options.prompt_file.read_bytes()
        prompt = {'file': options.prompt_file.name, 'section': options.prompt_section, 'sha256': hashlib.sha256(text).hexdigest()}
    generation = {
        'tool': options.tool, **({'model': options.model} if options.model else {}), 'prompt': prompt,
        **({'referenceSha256': hashlib.sha256(options.reference.read_bytes()).hexdigest()} if options.reference else {}),
        **({'seed': options.seed} if options.seed else {}), 'date': options.date, 'keying': keying,
    }
    frames = report['frames']
    clips[options.name] = {
        'file': f'assets/motion/{options.name}.webm', 'loop': loop,
        'durationMs': round(frames * 1000 / info['fps']), 'frames': frames,
        'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
        **({'turn': True} if options.turn else {}), **({'mirror': False} if options.no_mirror else {}),
        **({'label': {'zh': options.label_zh, 'en': options.label_en}} if options.label_zh else {}),
        'source': {
            'kind': KIND, 'file': options.source_ref or source.name, 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'fps': info['fps'], **({'crop': window} if inside else {}), 'generation': generation,
            'normalization': {'anchorClip': options.anchor_clip, 'stand': stand_mode, 'scale': round(scale, 6), 'offset': [x, y],
                              **({'follows': options.follow} if options.follow is not None else {}),
                              **({'start': options.start} if options.start is not None else {}),
                              **({'duration': options.duration} if options.duration is not None else {})},
        },
    }
    if options.category is not None:
        for category in categories:
            if category['id'] == options.category and options.name not in category['clips']:
                category['clips'].append(options.name)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'wrote {destination.relative_to(pack)} ({destination.stat().st_size} bytes) and motion.json')
    return 0


if __name__ == '__main__':
    sys.exit(main())
