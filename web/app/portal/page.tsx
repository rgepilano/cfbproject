import { ParamSelect } from "@/components/ParamSelect";
import { PortalBoard } from "@/components/PortalBoard";
import { getTeams, getTeamNIL } from "@/lib/db";
import { getPortalBoard } from "@/lib/portal";
import { DEFAULT_TEAM, param, POSITION_GROUPS, type SearchParams } from "@/lib/util";
import { cookies } from "next/headers";
import { SESSION_COOKIE, getSessionUsername } from "@/lib/session";
import { getUserDefaultTeam } from "@/lib/users";

export default async function PortalPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const teams = await getTeams();
  const requested = param(sp, "team");
  const c = (await cookies()).get(SESSION_COOKIE)?.value;
  const username = await getSessionUsername(c);
  const userTeam = username ? getUserDefaultTeam(username) : null;
  const team = requested && teams.includes(requested)
    ? requested
    : userTeam
    ? teams.find((t) => t.toLowerCase() === userTeam.toLowerCase()) ?? DEFAULT_TEAM
    : DEFAULT_TEAM;
  const { candidates, hasLocation } = await getPortalBoard(team);
  const nilVal = await getTeamNIL(team);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Portal Acquisition Board — {team}</h1>
          <div className="text-sm text-slate-600">Estimated NIL (2026): {nilVal ? `$${nilVal.toFixed(2)}M` : "—"}</div>
          <p className="text-sm text-slate-500">
            Uncommitted portal entrants plus high transfer-risk players elsewhere. Need comes from {team}&apos;s
            next-season pipeline gap. Fit = {hasLocation ? "home state + conference familiarity" : "conference familiarity (import team locations for home-state fit)"}.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ParamSelect name="team" value={team} options={teams} label="Team" />
          <a className="text-sm text-blue-600" href={`/api/export?table=portal_candidate`}>CSV</a>
        </div>
      </div>
      <PortalBoard candidates={candidates} groups={POSITION_GROUPS} />
    </>
  );
}
