import { HandCoins, Info, Moon, Receipt, RefreshCw, ShieldCheck, Sun, SunMoon } from "lucide-react";
import { usePrefs, type Theme } from "../../lib/prefs";
import { useNav } from "../MobileApp";
import { useOutbox } from "../outbox";
import { Chip, Panel, Row, Section, TopBar } from "../ui";

export function More({ demo }: { demo: boolean }) {
  const nav = useNav();
  const box = useOutbox();
  const { prefs, set } = usePrefs();
  const themes: { v: Theme; label: string; icon: typeof Sun }[] = [
    { v: "sistema", label: "Como el celular", icon: SunMoon }, { v: "claro", label: "Claro", icon: Sun }, { v: "oscuro", label: "Oscuro", icon: Moon },
  ];
  return (
    <>
      <TopBar title="Más" />
      <Section title="Registrar">
        <Panel>
          <Row icon={Receipt} title="Gasto" sub="Con foto de la boleta" onClick={() => nav.open({ name: "gasto" })} />
          <Row icon={HandCoins} title="Cobro" sub="Un cliente te pagó" onClick={() => nav.open({ name: "cobro" })} />
        </Panel>
      </Section>
      <Section title="Computador">
        <Panel>
          <Row icon={RefreshCw} title="Sincronizar" sub={box.items.length ? `${box.items.length} cambios por enviar` : "Por WiFi o por cable"} onClick={() => nav.open({ name: "sincronizar" })} />
        </Panel>
      </Section>
      <Section title="Apariencia">
        <div className="flex flex-wrap gap-2">
          {themes.map((t) => <Chip key={t.v} active={prefs.theme === t.v} onClick={() => set({ theme: t.v })}>{t.label}</Chip>)}
        </div>
      </Section>
      <Section title="Acerca de">
        <Panel>
          <Row icon={ShieldCheck} tone="success" title="Tus datos son tuyos" sub="Quedan cifrados en el celular y en tu computador. NÚCLEO no los ve." />
          <Row icon={Info} title={`NÚCLEO para celular · ${__APP_VERSION__}`} sub={demo ? "Demostración con datos ficticios" : "www.nucleoerp.cl"} />
        </Panel>
      </Section>
    </>
  );
}
