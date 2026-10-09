import Link from "next/link";
import { ParamSelect } from "@/components/ParamSelect";
import { PortalBoard } from "@/components/PortalBoard";
import { getTeams, getTeamNIL } from "@/lib/db";
import { getPortalBoard, getPortalYears } from "@/lib/portal";
import { DEFAULT_TEAM, param, POSITION_GROUPS, qs, type SearchParams } from "@/lib/util";
import { cookies } from "next/headers";
import { SESSION_COOKIE, getSessionUsername } from "@/lib/session";
import { getUserDefaultTeam } from "@/lib/users";

export default async function PortalPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const [teams, years, c] = await Promise.all([getTeams(), getPortalYears(), cookies().then((j) => j.get(SESSION_COOKIE)?.value)]);
  const requested = param(sp, "team");
  const username = await getSessionUsername(c);
  const userTeam = username ? getUserDefaultTeam(username) : null;
  const team = requested && teams.includes(requested)
    ? requested
    : userTeam
    ? teams.find((t) => t.toLowerCase() === userTeam.toLowerCase()) ?? DEFAULT_TEAM
    : DEFAULT_TEAM;
  const requestedYear = param(sp, "year");
  const year = requestedYear && years.includes(requestedYear) ? requestedYear : years[0];
  const [{ candidates, hasLocation }, nilVal] = await Promise.all([getPortalBoard(team, year, years[0]), getTeamNIL(team)]);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Portal Acquisition Board — {team}</h1>
          <div className="text-sm text-slate-600">Estimated NIL (2026): {nilVal ? `$${nilVal.toFixed(2)}M` : "—"}</div>
          <p className="text-sm text-slate-500">
            Players who entered the portal in {year}{year === years[0] ? ", plus high transfer-risk players elsewhere" : ""}.
            Need comes from {team}&apos;s next-season pipeline gap. Quality and eligibility use each player&apos;s prior season.
            Fit = {hasLocation ? "home state + conference familiarity" : "conference familiarity (import team locations for home-state fit)"}.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ParamSelect name="team" value={team} options={teams} label="Team" />
          <a className="text-sm text-blue-600" href={`/api/export?table=portal_candidate`}>CSV</a>
        </div>
      </div>
      <div className="flex gap-2">
        {years.map((y) => (
          <Link key={y} href={qs({ team }, { year: y })}
            className={`rounded px-3 py-1 text-sm ${y === year ? "bg-blue-600 text-white" : "border border-slate-300 dark:border-slate-700"}`}>
            {y}
          </Link>
        ))}
      </div>
      <PortalBoard key={year} candidates={candidates} groups={POSITION_GROUPS} />
    </>
  );
}
