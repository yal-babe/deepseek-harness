"""Normalize reviewed sprite cells into an exact grid without inventing animation frames.

Usage: python3 tools/import-generated-motion.py recipe.json [source-directory]
Requires Pillow. Recipes record actual row cuts and columns, rather than assuming
that the image generator obeyed the requested frame count. Artwork is only
extracted, calibrated for standing height, resized, and padded to a shared ground anchor.
"""
import hashlib
import json
import math
from pathlib import Path
import sys

from PIL import Image, ImageFilter
from collections import deque

def extract_row(row, columns, keep_detached=True):
    """Separate actual alpha islands before packing; generated columns are not uniform."""
    width, height = row.size
    remaining = list(row.getchannel('A').tobytes())
    components = []
    for index, value in enumerate(remaining):
        if value <= 4:
            continue
        queue = deque([index]); remaining[index] = 0
        points = []
        while queue:
            current = queue.popleft(); points.append(current)
            x, y = current % width, current // width
            neighbors = []
            if x: neighbors.append(current - 1)
            if x + 1 < width: neighbors.append(current + 1)
            if y: neighbors.append(current - width)
            if y + 1 < height: neighbors.append(current + width)
            for neighbor in neighbors:
                if remaining[neighbor] > 4:
                    remaining[neighbor] = 0; queue.append(neighbor)
        components.append(points)
    ranked = sorted(components, key=len, reverse=True)
    bodies = ranked[:columns]
    if len(bodies) != columns or len(bodies[-1]) < len(bodies[0]) * 0.25:
        raise ValueError(f'Row does not contain {columns} separate characters: {[len(body) for body in ranked[:columns + 1]]}')
    centers = sorted((sum(point % width for point in body) / len(body), id(body)) for body in bodies)
    body_owner = {identity: index for index, (_, identity) in enumerate(centers)}
    masks = [bytearray(width * height) for _ in range(columns)]
    for component in components:
        if not keep_detached and id(component) not in body_owner:
            continue
        center = sum(point % width for point in component) / len(component)
        owner = body_owner.get(id(component))
        if owner is None:
            owner = min(range(columns), key=lambda index: abs(centers[index][0] - center))
        for point in component:
            masks[owner][point] = 255
    cells = []
    for pixels in masks:
        mask = Image.frombytes('L', row.size, bytes(pixels))
        # Include original antialias pixels around the selected island, never a neighbor body.
        mask = mask.filter(ImageFilter.MaxFilter(3))
        alpha = Image.composite(row.getchannel('A'), Image.new('L', row.size), mask)
        cell = row.copy(); cell.putalpha(alpha)
        box = alpha.getbbox()
        if box is None:
            raise ValueError('Empty extracted cell')
        cell = cell.crop(box)
        cells.append((cell, (0, 0, cell.width, cell.height)))
    return cells


def body_height(cell):
    # Analyze a small alpha mask; the original artwork is never painted or filtered.
    mask = cell.getchannel('A').resize((max(1, cell.width // 2), max(1, cell.height // 2)))
    mask = mask.point(lambda value: 255 if value > 128 else 0).filter(ImageFilter.MaxFilter(3))
    pixels = list(mask.tobytes())
    width = mask.width
    best_area, best_height = 0, 1
    for index, value in enumerate(pixels):
        if not value:
            continue
        queue = deque([index]); pixels[index] = 0
        area, top, bottom = 0, index // width, index // width
        while queue:
            current = queue.popleft(); area += 1
            x, y = current % width, current // width
            top, bottom = min(top, y), max(bottom, y)
            neighbors = []
            if x: neighbors.append(current - 1)
            if x + 1 < width: neighbors.append(current + 1)
            if y: neighbors.append(current - width)
            if y + 1 < mask.height: neighbors.append(current + width)
            for neighbor in neighbors:
                if pixels[neighbor]: pixels[neighbor] = 0; queue.append(neighbor)
        if area > best_area: best_area, best_height = area, bottom - top + 1
    return best_height * cell.height / mask.height


recipe = json.loads(Path(sys.argv[1]).read_text())
pack = Path(__file__).resolve().parents[1] / 'packs/whaletail-maid'
manifest_path = pack / 'motion.json'
manifest = json.loads(manifest_path.read_text())
for entry in recipe['animations']:
    source = (Path(sys.argv[2]) / entry['source']) if len(sys.argv) > 2 else Path(entry['source'])
    image = Image.open(source).convert('RGBA')
    columns = entry.get('columns', 8)
    edges = entry['rowEdges']
    if edges[0] < 0 or edges[-1] > image.height or any(a >= b for a, b in zip(edges, edges[1:])):
        raise ValueError(f"Invalid row cuts for {entry['name']}")
    frames = []
    extraction = []
    frame_rows = []
    row_columns = entry.get('rowColumns', [columns] * (len(edges) - 1))
    if len(row_columns) != len(edges) - 1 or any(count < 1 or count > columns for count in row_columns):
        raise ValueError(f"Invalid per-row columns for {entry['name']}")
    for row_index, (top, bottom) in enumerate(zip(edges, edges[1:])):
        count = row_columns[row_index]
        frame_rows.extend([row_index] * count)
        row = image.crop((0, top, image.width, bottom))
        try:
            frames.extend(extract_row(row, count))
            extraction.append('separate-alpha-islands')
        except ValueError:
            # Touching silhouettes cannot be separated into full islands. Use reviewed
            # column cuts and retain each primary silhouette, excluding neighbor fragments.
            cuts = entry.get('columnEdges', [round(column * image.width / count) for column in range(count + 1)])
            if len(cuts) != count + 1 or cuts[0] != 0 or cuts[-1] != image.width or any(a >= b for a, b in zip(cuts, cuts[1:])):
                raise ValueError(f"Invalid column cuts in {entry['name']}")
            for left, right in zip(cuts, cuts[1:]):
                frames.extend(extract_row(row.crop((left, 0, right, row.height)), 1, keep_detached=False))
            extraction.append('reviewed-column-cuts-primary-island')
    row_factors = [1.0] * (len(edges) - 1)
    if entry.get('stabilizeStanding', False):
        reference_height = body_height(frames[0][0])
        row_factors = [reference_height / body_height(frames[sum(row_columns[:row])][0]) for row in range(len(edges) - 1)]
    scale = min(174 / (frames[0][1][3] - frames[0][1][1]),
                196 / max((box[3] - box[1]) * row_factors[frame_rows[index]] for index, (_, box) in enumerate(frames)),
                196 / max(cell.width for cell, _ in frames))
    rows = math.ceil(len(frames) / columns)
    atlas = Image.new('RGBA', (columns * 208, rows * 208))
    hashes = []
    for index, (cell, box) in enumerate(frames):
        # Center each extracted silhouette within its shared ground-anchored cell.
        art = cell.crop(box)
        art = art.resize((max(1, round(art.width * scale)), max(1, round(art.height * scale * row_factors[frame_rows[index]]))), Image.Resampling.LANCZOS)
        x = round(104 + (box[0] - cell.width / 2) * scale)
        y = 202 - art.height
        if x < 0 or x + art.width > 208:
            raise ValueError(f"Horizontal overflow in {entry['name']} frame {index}")
        canvas = Image.new('RGBA', (208, 208))
        canvas.alpha_composite(art, (x, y))
        hashes.append(hashlib.sha256(canvas.tobytes()).hexdigest())
        atlas.alpha_composite(canvas, ((index % columns) * 208, (index // columns) * 208))
    destination = pack / f"assets/motion/{entry['name']}.png"
    atlas.save(destination, optimize=True)
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    for segment in entry.get('segments', [{'name': entry['name'], 'start': 0, 'frames': len(frames), 'loop': False}]):
        start, count = segment['start'], segment['frames']
        if start < 0 or count < 1 or start + count > len(frames):
            raise ValueError(f"Invalid segment in {entry['name']}")
        manifest['clips'][segment['name']] = {
            'file': f"assets/motion/{entry['name']}.png", 'loop': segment['loop'],
            'durationMs': round(count * 1000 / entry['fps']), 'frames': count,
            'sheet': {'columns': columns, 'rows': rows, 'frames': count, 'startFrame': start},
            'sha256': digest,
            'source': {'kind': 'generated', 'description': entry['description'],
                       'imageSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                       'actualFrames': len(frames), 'uniquePixelFrames': len(set(hashes)),
                       'sourceSize': {'width': image.width, 'height': image.height},
                       'rowColumnEdges': [entry.get('columnEdges', [round(column * image.width / count) for column in range(count + 1)]) for count in row_columns],
                       'rowEdges': edges, 'rowColumns': row_columns, 'rowExtraction': extraction, 'rowHeightCalibration': row_factors, 'fps': entry['fps'], 'normalization': 'alpha-island-extraction-row-calibration-ground-anchor'},
        }
    print(entry['name'], len(frames), 'frames;', len(set(hashes)), 'unique;', destination.stat().st_size, 'bytes', flush=True)
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
