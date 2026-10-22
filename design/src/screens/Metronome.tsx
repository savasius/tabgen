import { useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

function tempoName(bpm: number, t: (k: "metronome.tempoNames.largo" | "metronome.tempoNames.andante" | "metronome.tempoNames.moderato" | "metronome.tempoNames.allegro" | "metronome.tempoNames.presto") => string) {
  if (bpm < 60) return t("metronome.tempoNames.largo");
  if (bpm < 88) return t("metronome.tempoNames.andante");
  if (bpm < 120) return t("metronome.tempoNames.moderato");
  if (bpm < 160) return t("metronome.tempoNames.allegro");
  return t("metronome.tempoNames.presto");
}

export function Metronome() {
  const { t } = useApp();
  const [bpm, setBpm] = useState(96);
  const [playing, setPlaying] = useState(false);
  const [beat, setBeat] = useState(0);
  const [beats, setBeats] = useState(4);
  const [accent, setAccent] = useState(true);
  const [sub, setSub] = useState(1);
  const taps = useRef<number[]>([]);

  useEffect(() => {
    if (!playing) return;
    const iv = window.setInterval(() => setBeat((b) => (b + 1) % beats), (60 / bpm / sub) * 1000);
    return () => window.clearInterval(iv);
  }, [playing, bpm, beats, sub]);

  const tap = () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((x) => now - x < 3000), now];
    if (taps.current.length >= 2) {
      const diffs = taps.current.slice(1).map((x, i) => x - taps.current[i]);
      const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      setBpm(Math.round(Math.min(240, Math.max(40, 60000 / avg))));
    }
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="text-3xl font-semibold">{t("metronome.title")}</h1>
      <p className="mt-1 text-muted-foreground">{t("metronome.subtitle")}</p>

      <div className="mt-8 flex justify-center gap-3">
        {Array.from({ length: beats }, (_, i) => (
          <span
            key={i}
            className={cn(
              "size-6 rounded-full border-2",
              playing && beat === i ? (i === 0 && accent ? "border-primary bg-primary" : "border-foreground bg-foreground") : "border-border",
            )}
          />
        ))}
      </div>
      <p className="mt-6 text-center font-mono text-7xl font-semibold tabular">{bpm}</p>
      <p className="text-center text-sm text-muted-foreground">{tempoName(bpm, t)}</p>
      <Slider className="mt-6" min={40} max={220} value={[bpm]} onValueChange={([v]) => setBpm(v ?? 96)} />

      <div className="mt-8 grid grid-cols-2 gap-3">
        <Button size="lg" variant="glow" onClick={() => setPlaying((p) => !p)}>
          {playing ? t("player.pause") : t("player.play")}
        </Button>
        <Button size="lg" variant="outline" onClick={tap}>
          {t("metronome.tap")}
        </Button>
      </div>

      <div className="mt-8 space-y-4 rounded-2xl border border-border bg-card p-4">
        <label className="flex items-center justify-between text-sm">
          {t("metronome.timeSig")}
          <select className="h-9 rounded-lg border border-border bg-background px-2" value={beats} onChange={(e) => setBeats(Number(e.target.value))}>
            {[2, 3, 4, 6].map((n) => (
              <option key={n} value={n}>
                {n}/4
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between text-sm">
          {t("metronome.accent")}
          <Switch checked={accent} onCheckedChange={setAccent} />
        </label>
        <label className="flex items-center justify-between text-sm">
          {t("metronome.subdivision")}
          <select className="h-9 rounded-lg border border-border bg-background px-2" value={sub} onChange={(e) => setSub(Number(e.target.value))}>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </label>
        <p className="text-xs text-muted-foreground">{t("metronome.trainerBody", { n: 4, s: 4, max: 140 })}</p>
      </div>
    </div>
  );
}
