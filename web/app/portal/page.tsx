import { ParamSelect } from "@/components/ParamSelect";
import { PortalBoard } from "@/components/PortalBoard";
import { getTeams } from "@/lib/db";
import { getPortalBoard } from "@/lib/portal";
import { DEFAULT_TEAM, param, POSITION_GROUPS, type SearchParams } from "@/lib/util";

export default async function PortalPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const teams = await getTeams();
  const requested = param(sp, "team");
  const team = requested && teams.includes(requested) ? requested : DEFAULT_TEAM;
  const { candidates, hasLocation } = await getPortalBoard(team);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Portal Acquisition Board — {team}</h1>
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
