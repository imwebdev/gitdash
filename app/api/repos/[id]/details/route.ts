import { NextResponse } from "next/server";
import { bootstrap } from "@/lib/bootstrap";
import { getRepoById, getRecentActions, getSnapshot } from "@/lib/db/repos";
import { getRecentCommits, getRepoLogMetadata } from "@/lib/git/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await bootstrap();

  const { id } = await ctx.params;
  const repoId = Number(id);
  if (!Number.isInteger(repoId) || repoId <= 0) {
    return NextResponse.json({ error: "invalid repo id" }, { status: 400 });
  }

  const repo = getRepoById(repoId);
  if (!repo || repo.deletedAt !== null) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }

  const snap = getSnapshot(repoId);

  const [commitsRes, metaRes] = await Promise.allSettled([
    getRecentCommits(repo.repoPath, 10),
    getRepoLogMetadata(repo.repoPath),
  ]);

  const recentCommits = commitsRes.status === "fulfilled" ? commitsRes.value : [];
  const logMeta = metaRes.status === "fulfilled"
    ? metaRes.value
    : { defaultBranch: null, totalCommits: null };

  const recentActions = getRecentActions(repoId, 5);

  return NextResponse.json({
    recentCommits,
    recentActions,
    metadata: {
      fullPath: repo.repoPath,
      defaultBranch: logMeta.defaultBranch,
      remoteUrl: snap?.remoteUrl ?? null,
      githubOwner: repo.githubOwner,
      githubName: repo.githubName,
      totalCommits: logMeta.totalCommits,
    },
  });
}
