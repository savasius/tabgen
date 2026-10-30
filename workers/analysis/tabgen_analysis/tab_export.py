"""alphaTex + MusicXML from assigned tab notes, quantized onto the Phase 1 beat grid.

Each Phase 1 beat is one quarter note so audio time can be mapped to alphaTab ticks
as `beat_index * 960 + fraction * 960` without depending on a constant BPM.
"""

from __future__ import annotations

from xml.etree.ElementTree import Element, SubElement, tostring
from xml.dom import minidom

from .fingering import TUNING_NAMES

TICKS_PER_BEAT = 960
SUBDIV = 4  # 16ths per beat
DUR_TOKENS = {1: "16", 2: "8", 4: "4", 8: "2", 16: "1"}


def _esc(s: str) -> str:
    return (s or "").replace("\\", "").replace('"', "'")[:80]


def sixteenth_times(beats: list[float], duration: float) -> list[float]:
    if not beats:
        return [0.0]
    times = []
    diffs = [beats[i + 1] - beats[i] for i in range(len(beats) - 1)]
    med = sorted(diffs)[len(diffs) // 2] if diffs else 0.5
    for i, b in enumerate(beats):
        nxt = beats[i + 1] if i + 1 < len(beats) else min(duration, b + med)
        step = (nxt - b) / SUBDIV
        for k in range(SUBDIV):
            times.append(b + k * step)
    return times


def snap_index(t: float, grid: list[float]) -> int:
    if not grid:
        return 0
    lo, hi = 0, len(grid) - 1
    while lo < hi:
        mid = (lo + hi + 1) >> 1
        if grid[mid] <= t + 1e-6:
            lo = mid
        else:
            hi = mid - 1
    if lo + 1 < len(grid) and abs(grid[lo + 1] - t) < abs(grid[lo] - t):
        return lo + 1
    return lo


def quantize_notes(notes: list[dict], beats: list[float], duration: float) -> list[dict]:
    grid = sixteenth_times(beats, duration)
    if not grid:
        return []
    last = duration if duration > grid[-1] else grid[-1] + (grid[-1] - grid[-2] if len(grid) > 1 else 0.25)
    grid_end = grid + [last]
    out = []
    for n in notes:
        if n.get("string") is None or n.get("fret") is None:
            continue
        i0 = snap_index(float(n["start"]), grid)
        i1 = snap_index(float(n["end"]), grid)
        if i1 <= i0:
            i1 = i0 + 1
        i1 = min(i1, len(grid))
        q = {
            **n,
            "qstart": round(grid[i0], 4),
            "qend": round(grid_end[min(i1, len(grid_end) - 1)], 4),
            "slot0": i0,
            "slot1": i1,
            "dur16": max(1, i1 - i0),
        }
        out.append(q)
    return out


# alphaTab 1.8 note-property tokens (see https://alphatab.net/docs/alphatex/note-properties).
# `{p}` is beat *pop*, not pull-off. Pull-off is `{h}` with a lower dest fret on the same string.
# `{b (N)}` is a single bend point and does not draw an arrow; use `{b (0 N)}` (quarter-tones).
# `{/}` and `{~}` are not valid tags.
ALPHATEX_TECH = {
    "bend": "b",
    "hammer": "h",
    "pull": "h",
    "slide": "sl",
    "vibrato": "v",
    "palmMute": "pm",
}


def _tech_suffix(note: dict) -> str:
    kinds = []
    for t in note.get("techniques") or []:
        k = t["type"]
        if k not in kinds:
            kinds.append(k)
    # One slur mark: hammer/pull wins over slide. Duplicate `{h h}` also fails to parse.
    if "hammer" in kinds or "pull" in kinds:
        kinds = [k for k in kinds if k != "slide"]
    bits = []
    seen: set[str] = set()
    for k in kinds:
        tok = ALPHATEX_TECH.get(k)
        if not tok or tok in seen:
            continue
        seen.add(tok)
        if k == "bend":
            bt = next(t for t in note["techniques"] if t["type"] == "bend")
            qt = max(1, min(12, int(bt.get("quarter_tones") or 2)))
            # Points are spread evenly over the note: bend-and-release returns to 0.
            bits.append(f"b (0 {qt} {qt} 0)" if bt.get("release") else f"b (0 {qt})")
        else:
            bits.append(tok)
    if not bits:
        return ""
    return "{" + " ".join(bits) + "}"


def _note_tex(n: dict) -> str:
    return f"{int(n['fret'])}.{int(n['string'])}{_tech_suffix(n)}"


def _emit_slot(notes: list[dict]) -> str:
    if not notes:
        return "r"
    if len(notes) == 1:
        return _note_tex(notes[0])
    inner = " ".join(_note_tex(n) for n in sorted(notes, key=lambda x: -int(x["string"])))
    return f"({inner})"


def _slots(qnotes: list[dict]) -> dict[int, list[dict]]:
    """Group quantized notes by 16th slot, one note per string (two onsets that snap to the
    same slot on one string would be an impossible beat; keep the more confident one)."""
    by_slot: dict[int, dict[int, dict]] = {}
    for n in qnotes:
        row = by_slot.setdefault(int(n["slot0"]), {})
        s = int(n["string"])
        if s not in row or float(n.get("confidence") or 0) > float(row[s].get("confidence") or 0):
            row[s] = n
    return {k: sorted(v.values(), key=lambda x: -int(x["string"])) for k, v in by_slot.items()}


def _bar_tempo(beats: list[float], beat_ids: list[int], duration: float, fallback: int) -> int:
    i0, i1 = beat_ids[0], beat_ids[-1]
    if i0 >= len(beats):
        return fallback
    end = beats[i1 + 1] if i1 + 1 < len(beats) else None
    if end is None:
        if i1 > i0:  # last bar: extrapolate from its own beats
            span = (beats[min(i1, len(beats) - 1)] - beats[i0]) / max(1, min(i1, len(beats) - 1) - i0)
            return max(20, min(300, int(round(60.0 / max(span, 1e-3)))))
        return fallback
    span = (end - beats[i0]) / (i1 - i0 + 1)
    return max(20, min(300, int(round(60.0 / max(span, 1e-3)))))


def _with_beat_effect(token: str, effect: str) -> str:
    """Add a beat effect to an emitted `:dur body` token (`body` may already carry `{...}`)."""
    dur, body = token.split(" ", 1)
    if body.startswith("("):
        close = body.index(")") + 1
        head, rest = body[:close], body[close:]
        if rest.startswith("{"):
            return f"{dur} {head}{{{rest[1:-1]} {effect}}}"
        return f"{dur} {head}{{{effect}}}"
    if body.endswith("}"):
        return f"{dur} {body[:-1]} {effect}}}"
    return f"{dur} {body}{{{effect}}}"


def _emit_tie(notes: list[dict]) -> str:
    ties = [f"{int(n['fret'])}.{int(n['string'])}{{t}}" for n in sorted(notes, key=lambda x: -int(x["string"]))]
    return ties[0] if len(ties) == 1 else "(" + " ".join(ties) + ")"


def _slot_duration(starting: list[dict], by_slot: dict[int, list[dict]], s0: int, i: int, nslots: int) -> int:
    """Longest note in the slot, cut at the next onset inside the bar (and the bar end)."""
    want = max(int(n["dur16"]) for n in starting)
    nxt = nslots
    for j in range(i + 1, nslots):
        if by_slot.get(s0 + j):
            nxt = j
            break
    return max(1, min(want, nxt - i))


def _chunks(n16: int) -> list[int]:
    out = []
    left = n16
    for size in (16, 8, 4, 2, 1):
        while left >= size:
            out.append(size)
            left -= size
    return out or [1]


def to_alphatex(
    notes: list[dict],
    bars: list[dict],
    beats: list[float],
    duration: float,
    *,
    title: str = "",
    bpm: float = 120,
    tuning: list[str] | None = None,
    ts: str = "4/4",
) -> str:
    tuning = tuning or TUNING_NAMES
    # alphaTab tuning is high e → low E
    tex_tuning = " ".join(reversed(tuning))
    beats_n, beat_unit = (ts.split("/") + ["4"])[:2]
    by_slot = _slots(quantize_notes(notes, beats, duration))

    lines = [
        f'\\title "{_esc(title) or "TabGen"}"',
        f"\\tempo {max(1, int(round(bpm)))}",
        f"\\ts {beats_n} {beat_unit}",
        f"\\tuning {tex_tuning}",
        r"\instrument AcousticGuitarSteel",
        ".",
    ]
    grid = sixteenth_times(beats, duration)
    cur_tempo = max(1, int(round(bpm)))
    cur_ts = int(beats_n) if str(beats_n).isdigit() else 4

    for bar in bars:
        beat_ids = bar.get("beats") or []
        nbeats = len(beat_ids)
        if nbeats == 0:
            lines.append(":1 r |")
            continue
        # Each beat is a quarter note, so the synth only follows the recording if every bar
        # carries its own measured tempo (live songs drift several BPM).
        bar_tempo = _bar_tempo(beats, beat_ids, duration, cur_tempo)
        # slots covering this bar: 4 sixteenths per beat in the global grid
        if not beats or beat_ids[0] >= len(beats):
            lines.append(":4 r |")
            continue
        start_t = beats[beat_ids[0]]
        s0 = snap_index(start_t + 1e-4, grid) if grid else 0
        # align to beat start
        s0 = beat_ids[0] * SUBDIV if beat_ids[0] * SUBDIV < len(grid) else s0
        nslots = nbeats * SUBDIV
        parts: list[str] = []
        i = 0
        while i < nslots:
            slot = s0 + i
            starting = by_slot.get(slot) or []
            if starting:
                # One voice: a ringing note is cut at the next onset. Jumping past later
                # onsets (the old behaviour) silently deleted every note under a long one.
                dur = _slot_duration(starting, by_slot, s0, i, nslots)
                chunks = _chunks(dur)
                used = 0
                for ci, ch in enumerate(chunks):
                    tok = DUR_TOKENS[ch]
                    # Continuations are ties so playback does not re-pick; effects stay on the attack.
                    body = _emit_slot(starting) if ci == 0 else _emit_tie(starting)
                    parts.append(f":{tok} {body}")
                    used += ch
                i += used
            else:
                # rest until next onset in this bar
                nxt = nslots
                for j in range(i + 1, nslots):
                    if by_slot.get(s0 + j):
                        nxt = j
                        break
                rest = nxt - i
                chunks = _chunks(rest)
                for ch in chunks:
                    parts.append(f":{DUR_TOKENS[ch]} r")
                i += rest
        if parts and abs(bar_tempo - cur_tempo) >= max(2, 0.02 * cur_tempo):
            parts[0] = _with_beat_effect(parts[0], f"tempo {bar_tempo}")
            cur_tempo = bar_tempo
        # A bar with more or fewer beats than the time signature (pickups, a missed downbeat)
        # gets its own signature: alphaTab otherwise starts the next bar after the nominal
        # length, and the tab / Tab-gitar timeline drifts from the recording.
        head = ""
        if nbeats != cur_ts:
            head = f"\\ts {nbeats} {beat_unit} "
            cur_ts = nbeats
        lines.append(head + " ".join(parts) + " |")
    return "\n".join(lines) + "\n"


def _step_alter(midi: int) -> tuple[str, int, int]:
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    n = names[midi % 12]
    step = n[0]
    alter = 1 if "#" in n else 0
    octave = midi // 12 - 1
    return step, alter, octave


def to_musicxml(
    notes: list[dict],
    bars: list[dict],
    beats: list[float],
    duration: float,
    *,
    title: str = "",
    bpm: float = 120,
    tuning: list[str] | None = None,
    ts: str = "4/4",
) -> str:
    tuning = tuning or TUNING_NAMES
    beats_n, beat_unit = (int(x) for x in ((ts.split("/") + ["4"])[:2]))
    by_slot = _slots(quantize_notes(notes, beats, duration))

    score = Element("score-partwise", version="3.1")
    work = SubElement(score, "work")
    SubElement(work, "work-title").text = title or "TabGen"
    ident = SubElement(score, "identification")
    enc = SubElement(ident, "encoding")
    SubElement(enc, "software").text = "TabGen"
    part_list = SubElement(score, "part-list")
    sp = SubElement(part_list, "score-part", id="P1")
    SubElement(sp, "part-name").text = "Guitar"
    part = SubElement(score, "part", id="P1")

    grid = sixteenth_times(beats, duration)
    divisions = SUBDIV  # duration 1 = 16th, 4 = quarter

    for bi, bar in enumerate(bars):
        measure = SubElement(part, "measure", number=str(bi + 1))
        beat_ids = bar.get("beats") or []
        nbeats = max(1, len(beat_ids))
        if bi == 0:
            attr = SubElement(measure, "attributes")
            SubElement(attr, "divisions").text = str(divisions)
            time = SubElement(attr, "time")
            SubElement(time, "beats").text = str(nbeats)
            SubElement(time, "beat-type").text = str(beat_unit)
            cur_beats = nbeats
            clef = SubElement(attr, "clef")
            SubElement(clef, "sign").text = "TAB"
            SubElement(clef, "line").text = "5"
            staff = SubElement(attr, "staff-details")
            SubElement(staff, "staff-lines").text = "6"
            # MusicXML staff-tuning line 1 = bottom string (low E)
            for line, name in enumerate(tuning, start=1):
                st = SubElement(staff, "staff-tuning", line=str(line))
                step, alter, octv = _step_alter(_midi_from_name(name))
                SubElement(st, "tuning-step").text = step
                if alter:
                    SubElement(st, "tuning-alter").text = str(alter)
                SubElement(st, "tuning-octave").text = str(octv)
            dir_ = SubElement(measure, "direction", placement="above")
            dt = SubElement(dir_, "direction-type")
            met = SubElement(dt, "metronome")
            SubElement(met, "beat-unit").text = "quarter"
            SubElement(met, "per-minute").text = str(int(round(bpm)))
        elif nbeats != cur_beats:
            # irregular bar (pickup, missed downbeat): its own signature keeps it in time
            attr = SubElement(measure, "attributes")
            time = SubElement(attr, "time")
            SubElement(time, "beats").text = str(nbeats)
            SubElement(time, "beat-type").text = str(beat_unit)
            cur_beats = nbeats
        s0 = (beat_ids[0] if beat_ids else 0) * SUBDIV
        nslots = nbeats * SUBDIV
        i = 0
        while i < nslots:
            starting = by_slot.get(s0 + i) or []
            if starting:
                dur = _slot_duration(starting, by_slot, s0, i, nslots)
                for ni, n in enumerate(starting):
                    note = SubElement(measure, "note")
                    if ni > 0:
                        SubElement(note, "chord")
                    step, alter, octv = _step_alter(int(n["midi"]))
                    pitch = SubElement(note, "pitch")
                    SubElement(pitch, "step").text = step
                    if alter:
                        SubElement(pitch, "alter").text = str(alter)
                    SubElement(pitch, "octave").text = str(octv)
                    SubElement(note, "duration").text = str(dur)
                    SubElement(note, "type").text = {1: "16th", 2: "eighth", 4: "quarter", 8: "half", 16: "whole"}.get(
                        dur, "16th")
                    notations = SubElement(note, "notations")
                    tech = SubElement(notations, "technical")
                    SubElement(tech, "string").text = str(int(n["string"]))
                    SubElement(tech, "fret").text = str(int(n["fret"]))
                    for t in n.get("techniques") or []:
                        if t["type"] == "bend":
                            b = SubElement(tech, "bend")
                            SubElement(b, "bend-alter").text = str(round((t.get("cents") or 100) / 100.0, 2))
                        elif t["type"] == "hammer":
                            SubElement(tech, "hammer-on", type="start", number="1")
                        elif t["type"] == "pull":
                            SubElement(tech, "pull-off", type="start", number="1")
                        elif t["type"] == "slide":
                            SubElement(tech, "slide", type="start", number="1")
                        elif t["type"] == "vibrato":
                            orns = notations.find("ornaments")
                            if orns is None:
                                orns = SubElement(notations, "ornaments")
                            SubElement(orns, "wavy-line", type="start")
                        elif t["type"] == "palmMute":
                            SubElement(tech, "other-technical").text = "palm mute"
                i += dur
            else:
                nxt = nslots
                for j in range(i + 1, nslots):
                    if by_slot.get(s0 + j):
                        nxt = j
                        break
                rest_dur = nxt - i
                note = SubElement(measure, "note")
                SubElement(note, "rest")
                SubElement(note, "duration").text = str(rest_dur)
                i += rest_dur
        if not list(measure):
            note = SubElement(measure, "note")
            SubElement(note, "rest")
            SubElement(note, "duration").text = str(nbeats * divisions)

    raw = tostring(score, encoding="unicode")
    pretty = minidom.parseString(
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" '
        '"http://www.musicxml.org/dtds/partwise.dtd">' + raw
    ).toprettyxml(indent="  ")
    # minidom adds its own XML header
    if pretty.startswith("<?xml"):
        return pretty
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + pretty


def _midi_from_name(name: str) -> int:
    step = name[:-1]
    octv = int(name[-1])
    semis = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6,
             "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}[step]
    return (octv + 1) * 12 + semis
