import { Pause, Play, Repeat, SkipBack, SkipForward, Gauge, Guitar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/segmented";
import { formatTime } from "@/lib/utils";
import { useT } from "@/lib/store";
import type { Loop, SoundSource } from "@/player";
import { cn } from "@/lib/utils";

export function Transport({
  time,
  duration,
  playing,
  speed,
  loop,
  countIn,
  counting,
  onToggle,
  onSeek,
  onSpeed,
  onLoopClear,
  onCountIn,
  onSkip,
  soundSource,
  onSoundSource,
  tabAvailable,
  guitarAvailable,
}: {
  time: number;
  duration: number;
  playing: boolean;
  speed: number;
  loop: Loop | null;
  countIn: boolean;
  counting: number;
  onToggle: () => void;
  onSeek: (t: number) => void;
  onSpeed: (s: number) => void;
  onLoopClear: () => void;
  onCountIn: (v: boolean) => void;
  onSkip: (dt: number) => void;
  soundSource?: SoundSource;
  onSoundSource?: (s: SoundSource) => void;
  tabAvailable?: boolean;
  guitarAvailable?: boolean;
}) {
  const t = useT();
  const hint = soundSource === "guitar"
    ? t("player.soundGuitarHint")
    : soundSource === "tab"
      ? t("player.soundTabHint")
      : t("player.soundOriginalHint");
  return (
    <div className="rounded-2xl border border-border bg-card/95 p-3 shadow-[0_8px_30px_rgb(0_0_0/0.35)] backdrop-blur-xl">
      <div className="mb-2 flex items-center gap-3">
        <span className="w-10 text-right font-mono text-xs tabular text-muted-foreground">{formatTime(time)}</span>
        <Slider min={0} max={duration} step={0.1} value={[time]} onValueChange={([v]) => onSeek(v ?? 0)} />
        <span className="w-10 font-mono text-xs tabular text-muted-foreground">{formatTime(duration)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => onSkip(-5)} aria-label={t("player.back5")}>
            <SkipBack />
          </Button>
          <Button
            size="icon"
            variant="glow"
            onClick={onToggle}
            aria-label={playing ? t("player.pause") : t("player.play")}
            data-testid="play-toggle"
            className={cn(playing && counting > 0 && "animate-pulse-ring")}
          >
            {playing ? <Pause /> : <Play />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => onSkip(5)} aria-label={t("player.fwd5")}>
            <SkipForward />
          </Button>
          {playing && counting > 0 && (
            <span className="ml-1 text-lg font-semibold tabular">{Math.ceil(counting)}</span>
          )}
        </div>
        {onSoundSource && soundSource && (
          <div className="flex items-center gap-2" data-testid="sound-source" data-listen={soundSource} title={hint}>
            <Guitar className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <Segmented
              size="sm"
              value={soundSource}
              onChange={(v) => {
                if (v === "tab" && !tabAvailable) return
                if (v === "guitar" && !guitarAvailable) return
                onSoundSource(v)
              }}
              options={[
                { value: "original" satisfies SoundSource, label: t("player.soundOriginal"), hint: t("player.soundOriginalHint"), testId: "listen-original" },
                { value: "guitar", label: t("player.soundGuitar"), hint: t("player.soundGuitarHint"), testId: "listen-guitar", disabled: !guitarAvailable },
                { value: "tab", label: t("player.soundTab"), hint: t("player.soundTabHint"), testId: "listen-tab", disabled: !tabAvailable },
              ]}
            />
          </div>
        )}
        <div className="ml-auto flex items-center gap-3">
          {loop && (
            <Button variant="secondary" size="sm" onClick={onLoopClear} title={t("player.loopSet")}>
              <Repeat className="size-3.5" />
              {loop.label ?? t("player.loopAB")}
            </Button>
          )}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={countIn} onCheckedChange={onCountIn} />
            {t("player.countIn")}
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title={t("player.speed")}>
            <Gauge className="size-3.5" aria-hidden />
            <select
              className="h-8 rounded-md border border-border bg-background px-2 text-foreground"
              value={speed}
              onChange={(e) => onSpeed(Number(e.target.value))}
              aria-label={t("player.speed")}
            >
              {[0.5, 0.7, 0.8, 0.9, 1].map((s) => (
                <option key={s} value={s}>
                  {Math.round(s * 100)}%
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}
