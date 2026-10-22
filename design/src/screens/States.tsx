import { Link, useParams } from "react-router-dom";
import { useApp, type TKey } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { AlertTriangle, FileWarning, MicOff, Music, WifiOff, SearchX, HelpCircle } from "lucide-react";
import type { ReactNode } from "react";

const KINDS = ["empty", "too_long", "no_music", "decode", "server", "micDenied", "offline", "lowConfidence", "noTab", "notFound"] as const;
type Kind = (typeof KINDS)[number];

export function StatesIndex() {
  const { t } = useApp();
  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-3xl font-semibold">{t("states.title")}</h1>
      <p className="mt-1 mb-6 text-muted-foreground">{t("states.subtitle")}</p>
      <ul className="grid gap-2">
        {KINDS.map((k) => (
          <li key={k}>
            <Link to={`/states/${k}`} className="block rounded-xl border border-border bg-card px-4 py-3 hover:bg-accent">
              {k === "empty" ? t("states.emptyLibrary") : t(`states.${k}.title` as TKey)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StateScreen() {
  const { kind = "notFound" } = useParams();
  if (kind === "empty") {
    return (
      <div className="py-4">
        <iframe className="hidden" title="empty" />
        <EmptyRedirect />
      </div>
    );
  }
  return <ErrorState kind={(KINDS.includes(kind as Kind) ? kind : "notFound") as Kind} />;
}

function EmptyRedirect() {
  const { t } = useApp();
  return (
    <ErrorFrame
      icon={<Music className="size-8" />}
      title={t("library.empty.title")}
      body={t("library.empty.body")}
      actions={
        <>
          <Button asChild variant="glow">
            <Link to="/add">{t("library.empty.cta")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/song/sahil-yolu">{t("library.empty.demo")}</Link>
          </Button>
        </>
      }
    />
  );
}

const ICONS: Partial<Record<Kind, ReactNode>> = {
  too_long: <FileWarning className="size-8" />,
  no_music: <Music className="size-8" />,
  decode: <FileWarning className="size-8" />,
  server: <AlertTriangle className="size-8" />,
  micDenied: <MicOff className="size-8" />,
  offline: <WifiOff className="size-8" />,
  lowConfidence: <HelpCircle className="size-8" />,
  noTab: <Music className="size-8" />,
  notFound: <SearchX className="size-8" />,
};

export function ErrorState({ kind }: { kind: Kind }) {
  const { t } = useApp();
  const k = kind === "empty" ? "notFound" : kind;
  return (
    <ErrorFrame
      icon={ICONS[k] ?? <AlertTriangle className="size-8" />}
      title={t(`states.${k}.title` as TKey)}
      body={t(`states.${k}.body` as TKey)}
      actions={
        <>
          <Button asChild variant="glow">
            <Link to="/add">{t("common.retry")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/">{t("nav.library")}</Link>
          </Button>
        </>
      }
    />
  );
}

function ErrorFrame({ icon, title, body, actions }: { icon: ReactNode; title: string; body: string; actions: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
      <div className="mb-5 grid size-16 place-items-center rounded-2xl bg-destructive/10 text-destructive">{icon}</div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-muted-foreground">{body}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>
    </div>
  );
}
