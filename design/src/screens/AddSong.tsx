import { useNavigate, useSearchParams } from "react-router-dom";
import { Mic, Upload, FileVideo } from "lucide-react";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useRef, useState } from "react";

export function AddSong() {
  const { t } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "file";
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      <h1 className="text-3xl font-semibold tracking-tight">{t("add.title")}</h1>
      <p className="mt-1 mb-6 text-muted-foreground">{t("add.subtitle")}</p>
      <Tabs
        value={tab}
        onValueChange={(v) => {
          params.set("tab", v);
          setParams(params, { replace: true });
        }}
      >
        <TabsList className="w-full">
          <TabsTrigger value="file">
            <Upload className="mr-1 size-4" /> {t("add.tabs.file")}
          </TabsTrigger>
          <TabsTrigger value="youtube">
            <FileVideo className="mr-1 size-4" /> {t("add.tabs.youtube")}
          </TabsTrigger>
          <TabsTrigger value="mic">
            <Mic className="mr-1 size-4" /> {t("add.tabs.mic")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="file" className="mt-5">
          <FilePanel />
        </TabsContent>
        <TabsContent value="youtube" className="mt-5">
          <YoutubePanel />
        </TabsContent>
        <TabsContent value="mic" className="mt-5">
          <MicPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FilePanel() {
  const { t, setLibrary } = useApp();
  const nav = useNavigate();
  const [file, setFile] = useState<{ name: string; size: string } | null>(null);
  const [rights, setRights] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const pick = (name: string) => {
    setFile({ name, size: "8.4 MB · 4:12" });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("add.file.drop")}</CardTitle>
        <CardDescription>{t("add.file.local")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (f) pick(f.name);
            else pick("sahil-yolu.wav");
          }}
          className={cn(
            "rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors",
            over ? "border-primary bg-primary/10" : "border-border hover:bg-accent/40",
          )}
        >
          <Upload className="mx-auto mb-3 size-8 text-primary" />
          <p className="font-medium">{t("add.file.drop")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("add.file.or")}</p>
          <span className="mt-3 inline-flex h-10 items-center rounded-lg bg-secondary px-4 text-sm">{t("add.file.browse")}</span>
          <p className="mt-3 text-xs text-muted-foreground">{t("add.file.formats")}</p>
        </button>
        <input
          ref={input}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            pick(f?.name ?? "demo.mp3");
          }}
        />
        {file && (
          <div className="rounded-xl bg-muted p-3 text-sm">
            <p className="font-medium">{t("add.file.selected")}</p>
            <p className="text-muted-foreground">
              {file.name} · {file.size}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Input defaultValue={file.name.replace(/\.[^.]+$/, "")} aria-label={t("add.meta.title")} />
              <Input defaultValue="" placeholder={t("add.meta.artist")} />
            </div>
          </div>
        )}
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1" checked={rights} onChange={(e) => setRights(e.target.checked)} />
          {t("add.file.rights")}
        </label>
        <Button
          variant="glow"
          disabled={!file || !rights}
          onClick={() => {
            setLibrary((l) => [
              {
                id: "yeni-yukleme",
                title: file?.name.replace(/\.[^.]+$/, "") ?? "Yeni",
                artist: "—",
                source: "file",
                duration: 252,
                addedAt: "2026-10-22T13:50:00Z",
                status: "queued",
                progress: 0,
                coverHue: 32,
              },
              ...l,
            ]);
            nav("/processing/yeni-yukleme", { state: { simulate: true } });
          }}
        >
          {t("add.file.start")}
        </Button>
      </CardContent>
    </Card>
  );
}

function YoutubePanel() {
  const { t } = useApp();
  const nav = useNavigate();
  const [url, setUrl] = useState("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  const [mode, setMode] = useState<"playback" | "local">("playback");
  const valid = /youtu\.?be/.test(url);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("add.youtube.label")}</CardTitle>
        <CardDescription>{t("add.youtube.modeTitle")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("add.youtube.placeholder")} />
        {!valid && url && <p className="text-sm text-destructive">{t("add.youtube.invalid")}</p>}
        {valid && (
          <div className="flex gap-3 rounded-xl bg-muted p-3">
            <div className="size-16 rounded-lg bg-zinc-800" />
            <div>
              <p className="text-xs text-muted-foreground">{t("add.youtube.found")}</p>
              <p className="font-medium">Sahil Yolu (resmi video)</p>
              <p className="text-sm text-muted-foreground">Mavi Rüzgar · 4:12</p>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => setMode("playback")}
          className={cn("rounded-xl border p-4 text-left", mode === "playback" ? "border-primary bg-primary/10" : "border-border")}
        >
          <p className="font-medium">{t("add.youtube.modePlayback")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("add.youtube.modePlaybackBody")}</p>
        </button>
        <button
          type="button"
          onClick={() => setMode("local")}
          className={cn("rounded-xl border p-4 text-left", mode === "local" ? "border-primary bg-primary/10" : "border-border")}
        >
          <p className="font-medium">
            {t("add.youtube.modeLocal")} <span className="ml-1 text-xs text-muted-foreground">{t("common.soon")}</span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{t("add.youtube.modeLocalBody")}</p>
        </button>
        <Button variant="glow" disabled={!valid} onClick={() => nav(mode === "local" ? "/processing/gece-treni" : "/add?tab=file")}>
          {t("add.youtube.start")}
        </Button>
      </CardContent>
    </Card>
  );
}

function MicPanel() {
  const { t, setLibrary } = useApp();
  const nav = useNavigate();
  const [rec, setRec] = useState<"idle" | "live" | "done">("idle");
  const [sec, setSec] = useState(0);
  const [level, setLevel] = useState(0.2);

  const start = () => {
    setRec("live");
    setSec(0);
    const iv = window.setInterval(() => {
      setSec((s) => s + 1);
      setLevel(0.35 + Math.abs(Math.sin(Date.now() / 220)) * 0.55);
    }, 400);
    (window as unknown as { __mic?: number }).__mic = iv;
  };
  const stop = () => {
    window.clearInterval((window as unknown as { __mic?: number }).__mic);
    setRec("done");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("add.mic.title")}</CardTitle>
        <CardDescription>{t("add.mic.body")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-5">
        <button
          type="button"
          onClick={rec === "live" ? stop : start}
          className={cn(
            "grid size-28 place-items-center rounded-full border-4",
            rec === "live" ? "animate-pulse-ring border-destructive bg-destructive text-white" : "border-primary bg-primary/15 text-primary",
          )}
        >
          <Mic className="size-10" />
        </button>
        <p className="font-mono text-2xl tabular">{Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}</p>
        <div className="w-full">
          <p className="mb-1 text-xs text-muted-foreground">{t("add.mic.level")}</p>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn("h-full", level < 0.2 ? "bg-destructive" : "bg-success")}
              style={{ width: `${level * 100}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{level < 0.2 ? t("add.mic.tooQuiet") : t("add.mic.good")}</p>
        </div>
        {rec === "idle" && (
          <Button variant="glow" onClick={start}>
            {t("add.mic.start")}
          </Button>
        )}
        {rec === "live" && (
          <Button variant="destructive" onClick={stop}>
            {t("add.mic.stop")}
          </Button>
        )}
        {rec === "done" && (
          <div className="flex gap-2">
            <Button
              variant="glow"
              onClick={() => {
                setLibrary((l) => [
                  {
                    id: "mic-yeni",
                    title: t("add.tabs.mic"),
                    artist: "—",
                    source: "mic",
                    duration: sec,
                    addedAt: "2026-10-22T13:50:00Z",
                    status: "queued",
                    progress: 0,
                    coverHue: 340,
                  },
                  ...l,
                ]);
                nav("/processing/mic-yeni", { state: { simulate: true } });
              }}
            >
              {t("add.mic.analyze")}
            </Button>
            <Button variant="outline" onClick={() => setRec("idle")}>
              {t("add.mic.again")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
