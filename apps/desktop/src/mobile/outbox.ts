// Cola de lo que se hizo en el celular y aún no llega al computador.
// En la app instalada la cola vive en la base cifrada del celular (tabla sync_outbox, fase S0) y se
// vacía al sincronizar por cable o WiFi. En la demostración vive en memoria.
import { useSyncExternalStore } from "react";

export type OutboxKind = "venta" | "gasto" | "cobro" | "cliente";
export interface OutboxItem { id: string; kind: OutboxKind; label: string; amount_minor: number | null; at: string; apply?: () => Promise<void> }

let items: OutboxItem[] = [];
let lastSync: string | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const outbox = {
  /** `apply` es lo que hará el computador al recibirla (en la demostración se ejecuta al sincronizar). */
  add(kind: OutboxKind, label: string, amount_minor: number | null, apply?: () => Promise<void>) {
    items = [{ id: crypto.randomUUID(), kind, label, amount_minor, at: new Date().toISOString(), apply }, ...items];
    emit();
  },
  /** Simula la sincronización de la demostración: el computador recibe y confirma la cola. */
  async markSynced() {
    for (const it of [...items].reverse()) await it.apply?.();
    items = [];
    lastSync = new Date().toISOString();
    emit();
  },
};

let cached: { items: OutboxItem[]; lastSync: string | null } = { items, lastSync };
function get() {
  if (cached.items !== items || cached.lastSync !== lastSync) cached = { items, lastSync };
  return cached;
}

export function useOutbox() {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, get, get);
}

export function sinceText(iso: string | null): string {
  if (!iso) return "nunca";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}
