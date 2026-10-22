import { Pause, Play, Repeat, SkipBack, SkipForward, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { formatTime } from "@/lib/utils";
import { useT } from "@/lib/store";
import type { Loop } from "@/lib/player";
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
}) {
  const t = useT();
  return (
    <div className="rounded-2xl border border-border bg-card/90 p-3 shadow-lg backdrop-blur">
      <div className="mb-2 flex items-center gap-3">
        <span className="w-10 text-right font-mono text-xs tabular text-muted-foreground">{formatTime(time)}</span>
        <Slider min={0} max={duration} step={0.1} value={[time]} onValueChange={([v]) => onSeek(v ?? 0)} />
        <span className="w-10 font-mono text-xs tabular text-muted-foreground">{formatTime(duration)}</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
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
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Gauge className="size-3.5" />
          {t("player.speed")}
          <select
            className="h-8 rounded-md border border-border bg-background px-2 text-foreground"
            value={speed}
            onChange={(e) => onSpeed(Number(e.target.value))}
          >
            {[0.5, 0.7, 0.8, 0.9, 1].map((s) => (
              <option key={s} value={s}>
                {Math.round(s * 100)}%
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <Switch checked={countIn} onCheckedChange={onCountIn} />
          {t("player.countIn")}
        </label>
        {loop ? (
          <Button variant="secondary" size="sm" onClick={onLoopClear}>
            <Repeat className="size-3.5" />
            {loop.label ?? t("player.loopAB")}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">{t("player.loopSet")}</span>
        )}
      </div>
    </div>
  );
}
