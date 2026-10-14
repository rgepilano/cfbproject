import { DepthChartBoard } from "@/components/DepthChartBoard";
import { ParamSelect } from "@/components/ParamSelect";
import { getDepthChartData, getDepthChartYears } from "@/lib/depth-chart";
import { getTeams } from "@/lib/db";
import { DEFAULT_TEAM, param, type SearchParams } from "@/lib/util";
import { getSessionUsername, SESSION_COOKIE } from "@/lib/session";
import { getUserDefaultTeam } from "@/lib/users";
import { cookies } from "next/headers";

export default async function WhatIfPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const [teams, years, cookie] = await Promise.all([
    getTeams(), getDepthChartYears(), cookies().then((value) => value.get(SESSION_COOKIE)?.value),
  ]);
  const username = await getSessionUsername(cookie);
  const preferredTeam = username ? getUserDefaultTeam(username) : null;
  const requestedTeam = param(params, "team");
  const team = requestedTeam && teams.some((item) => item.toLowerCase() === requestedTeam.toLowerCase())
    ? teams.find((item) => item.toLowerCase() === requestedTeam.toLowerCase())!
    : teams.find((item) => item.toLowerCase() === (preferredTeam ?? DEFAULT_TEAM).toLowerCase()) ?? teams[0];
  if (!team || years.length === 0) return <p className="text-sm text-slate-500">No roster seasons are available.</p>;
  const requestedYear = param(params, "season");
  const year = requestedYear && years.includes(requestedYear) ? requestedYear : years[0];
  const data = await getDepthChartData(team, year, username);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">What-if Depth Chart</h1>
          <p className="text-sm text-slate-500">Arrange a team scenario by position and test portal additions against NIL estimates.</p>
        </div>
        <div className="flex flex-wrap gap-4">
          <ParamSelect name="team" value={team} options={teams} label="Team" />
          <ParamSelect name="season" value={year} options={years} label="Target season" />
        </div>
      </div>
      <DepthChartBoard key={`${team}:${year}`} team={team} season={year} {...data} />
    </>
  );
}