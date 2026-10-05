// Contrato con el backend Rust (apps/desktop/src-tauri/src/commands.rs).
// Fase 1: tipos escritos a mano y espejados; ver DECISIONS.md (tauri-specta, D-F1-03).
import { invoke } from "@tauri-apps/api/core";

export type BusinessProfile = "emprendedor" | "negocio" | "empresa";

export interface CompanyInfo {
  uid: string;
  name: string;
  profile: BusinessProfile;
  created_at: string;
}
export interface CreatedCompany {
  company: CompanyInfo;
  recovery_key: string;
}
export interface AppInfo {
  version: string;
  data_dir: string;
  backups_dir: string;
  companies: CompanyInfo[];
}
export interface ChainReport {
  entries: number;
  ok: boolean;
  broken_at: number | null;
}
export interface SessionInfo {
  company: CompanyInfo;
  cipher_version: string;
  customers: number;
  audit: ChainReport;
}
export interface Customer {
  id: number;
  uid: string;
  rut: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  created_at: string;
}
export interface NewCustomer {
  name: string;
  rut?: string;
  email?: string;
  phone?: string;
}
export interface BackupDone {
  path: string;
  file_name: string;
  size_bytes: number;
  verified: boolean;
  manifest: { created_at: string; counts: Record<string, number>; schema_version: number };
}
export interface CommandError {
  code: string;
  message: string;
}

export function errorMessage(e: unknown): string {
  if (typeof e === "object" && e !== null && "message" in e) return String((e as CommandError).message);
  return String(e);
}

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  createCompany: (name: string, profile: BusinessProfile) => invoke<CreatedCompany>("create_company", { name, profile }),
  openCompany: (uid: string) => invoke<SessionInfo>("open_company", { uid }),
  sessionInfo: () => invoke<SessionInfo>("session_info"),
  addCustomer: (input: NewCustomer) => invoke<Customer>("add_customer", { input }),
  searchCustomers: (query: string) => invoke<Customer[]>("search_customers", { query }),
  createBackup: (password: string) => invoke<BackupDone>("create_backup", { password }),
  restoreBackup: (path: string, password: string) => invoke<CompanyInfo>("restore_backup", { path, password }),
  verifyAudit: () => invoke<ChainReport>("verify_audit"),
  recoverKey: (uid: string, recovery: string) => invoke<void>("recover_key", { uid, recovery }),
};
