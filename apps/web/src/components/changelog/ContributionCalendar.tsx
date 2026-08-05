'use client';

import { useMemo } from 'react';
import { addDays, eachDayOfInterval, endOfWeek, format, startOfWeek, subDays } from 'date-fns';
import type { ChangelogContributionDay } from '@/lib/changelog-types';

/**
 * Port of the original `GitHubCalendar`: a 53-week x 7-day heatmap over the
 * trailing year, colored by the API's precomputed 0-4 intensity `level`.
 */

// GitHub's own dark-mode heatmap scale -- the empty-day color sits close to
// the page background instead of the light-mode grey, so the grid reads on
// a near-black surface instead of disappearing into it.
const DEFAULT_COLORS = ['rgba(255,255,255,0.06)', '#0e4429', '#006d32', '#26a641', '#39d353'];
const WEEK_COUNT = 53;
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type ContributionCalendarProps = {
  readonly data: readonly ChangelogContributionDay[];
  readonly colors?: readonly string[];
};

export function ContributionCalendar({ data, colors = DEFAULT_COLORS }: ContributionCalendarProps) {
  const contributions = useMemo(
    () => data.map((day) => ({ date: new Date(day.date), count: day.count, level: day.level })),
    [data],
  );
  const contributionByDay = useMemo(() => {
    const map = new Map<string, { readonly date: Date; readonly count: number; readonly level: number }>();
    for (const contribution of contributions) map.set(format(contribution.date, 'yyyy-MM-dd'), contribution);
    return map;
  }, [contributions]);

  const today = new Date();
  const startDate = subDays(today, 364);

  const weeks = useMemo(() => {
    const fallbackColor = colors[0] ?? DEFAULT_COLORS[0]!;
    const colorForLevel = (level: number): string => colors[Math.min(level, colors.length - 1)] ?? fallbackColor;

    const result: Array<{ readonly key: number; readonly days: Array<{ readonly date: Date; readonly color: string; readonly count: number }> }> = [];
    let currentWeekStart = startOfWeek(startDate, { weekStartsOn: 0 });

    for (let i = 0; i < WEEK_COUNT; i += 1) {
      const weekDays = eachDayOfInterval({ start: currentWeekStart, end: endOfWeek(currentWeekStart, { weekStartsOn: 0 }) });
      const days = weekDays.map((day) => {
        const contribution = contributionByDay.get(format(day, 'yyyy-MM-dd'));
        return {
          date: day,
          color: contribution === undefined ? fallbackColor : colorForLevel(contribution.level),
          count: contribution?.count ?? 0,
        };
      });
      result.push({ key: i, days });
      currentWeekStart = addDays(currentWeekStart, 7);
    }
    return result;
  }, [colors, contributionByDay, startDate]);

  const monthLabels = useMemo(() => {
    const labels: string[] = [];
    let currentMonth = startDate;
    for (let i = 0; i < 12; i += 1) {
      labels.push(format(currentMonth, 'MMM'));
      currentMonth = addDays(currentMonth, 30);
    }
    return labels;
  }, [startDate]);

  return (
    <div className="p-6 border border-[var(--aops-line-strong)] bg-[var(--aops-panel)]">
      <div className="flex">
        <div className="flex flex-col justify-between mt-5.5 mr-2">
          {DAY_LABELS.map((day) => (
            <span className="text-[10px] text-[var(--aops-faint)] h-3" key={day}>
              {day}
            </span>
          ))}
        </div>
        <div>
          <div className="flex w-full justify-between gap-4 mb-2">
            {monthLabels.map((label, index) => (
              <span className="text-[10px] text-[var(--aops-faint)]" key={`${label}-${index}`}>
                {label}
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            {weeks.map((week) => (
              <div className="flex flex-col gap-1" key={week.key}>
                {week.days.map((day, index) => (
                  <div
                    className="w-3 h-3"
                    key={index}
                    style={{ backgroundColor: day.color }}
                    title={`${format(day.date, 'PPP')}: ${day.count} contributions`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 justify-center flex gap-2 text-[10px] text-[var(--aops-faint)] items-center">
        <span>Less</span>
        {colors.map((color) => (
          <div className="w-3 h-3" key={color} style={{ backgroundColor: color }} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
