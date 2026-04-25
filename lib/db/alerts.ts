import { getDb } from "./schema";
import type { PullFinding } from "@/lib/security/post-pull";

export interface PullAlertRow {
  id: number;
  repoId: number;
  createdAt: number;
  acknowledgedAt: number | null;
  findings: PullFinding[];
}

interface PullAlertRaw {
  id: number;
  repo_id: number;
  created_at: number;
  acknowledged_at: number | null;
  findings_json: string;
}

function rawToAlert(r: PullAlertRaw): PullAlertRow {
  let findings: PullFinding[] = [];
  try {
    findings = JSON.parse(r.findings_json) as PullFinding[];
  } catch {
    findings = [];
  }
  return {
    id: r.id,
    repoId: r.repo_id,
    createdAt: r.created_at,
    acknowledgedAt: r.acknowledged_at,
    findings,
  };
}

export function insertPullAlert(repoId: number, findings: PullFinding[], now: number): void {
  const db = getDb();
  db.prepare(
    "DELETE FROM pull_alerts WHERE repo_id = ? AND acknowledged_at IS NULL",
  ).run(repoId);
  db.prepare(
    "INSERT INTO pull_alerts (repo_id, created_at, findings_json) VALUES (?, ?, ?)",
  ).run(repoId, now, JSON.stringify(findings));
}

export function getUnacknowledgedAlerts(repoId: number): PullAlertRow[] {
  const rows = getDb()
    .prepare<[number], PullAlertRaw>(
      "SELECT * FROM pull_alerts WHERE repo_id = ? AND acknowledged_at IS NULL ORDER BY created_at DESC",
    )
    .all(repoId);
  return rows.map(rawToAlert);
}

export function dismissAlert(alertId: number, now: number): boolean {
  const result = getDb()
    .prepare("UPDATE pull_alerts SET acknowledged_at = ? WHERE id = ? AND acknowledged_at IS NULL")
    .run(now, alertId);
  return result.changes > 0;
}

export function getUnacknowledgedAlertCount(repoId: number): number {
  const row = getDb()
    .prepare<[number], { cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM pull_alerts WHERE repo_id = ? AND acknowledged_at IS NULL",
    )
    .get(repoId);
  return row?.cnt ?? 0;
}

export function getUnacknowledgedAlertCounts(repoIds: number[]): Map<number, number> {
  if (repoIds.length === 0) return new Map();
  const placeholders = repoIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare<number[], { repo_id: number; cnt: number }>(
      `SELECT repo_id, COUNT(*) AS cnt FROM pull_alerts WHERE repo_id IN (${placeholders}) AND acknowledged_at IS NULL GROUP BY repo_id`,
    )
    .all(...repoIds);
  return new Map(rows.map((r) => [r.repo_id, r.cnt]));
}
