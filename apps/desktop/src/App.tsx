import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, type AppInfo, type CreatedCompany, type SessionInfo } from "./lib/api";
import { Onboarding } from "./screens/Onboarding";
import { RecoveryKey } from "./screens/RecoveryKey";
import { Workspace } from "./screens/Workspace";
import { Notice } from "./ui/primitives";

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [pendingKey, setPendingKey] = useState<CreatedCompany | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (openUid?: string) => {
    try {
      const i = await api.appInfo();
      setInfo(i);
      const uid = openUid ?? session?.company.uid ?? i.companies[0]?.uid;
      if (uid) setSession(await api.openCompany(uid));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [session?.company.uid]);

  // Carga inicial una sola vez al abrir la aplicación.
  useEffect(() => { void load(); }, []);

  if (error) return <div className="p-8"><Notice tone="error">{error}</Notice></div>;
  if (!info) return <div className="p-8 text-muted">Abriendo NÚCLEO…</div>;
  if (pendingKey) {
    return <RecoveryKey recoveryKey={pendingKey.recovery_key} onDone={() => { const uid = pendingKey.company.uid; setPendingKey(null); void load(uid); }} />;
  }
  if (info.companies.length === 0 || !session) return <Onboarding onCreated={setPendingKey} />;
  return <Workspace info={info} session={session} onSwitch={(uid) => void load(uid)} onReload={() => void load()} />;
}
