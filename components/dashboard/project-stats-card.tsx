"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp } from "lucide-react";

type DashboardProject = {
  updatedAt: string;
  assets: number;
  visibility: "PRIVATE" | "UNLISTED" | "PUBLIC";
};

type Props = {
  projects: DashboardProject[];
  className?: string;
};

type MetricId = "updates" | "assetsTouched" | "publicUpdates";

const shortDayFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

const longDayFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export default function ProjectStatsCard({ projects, className }: Props) {
  const [activeMetric, setActiveMetric] = useState<MetricId>("updates");

  const totalAssets = useMemo(
    () => projects.reduce((sum, project) => sum + project.assets, 0),
    [projects],
  );

  const publicProjects = useMemo(
    () => projects.filter((project) => project.visibility === "PUBLIC").length,
    [projects],
  );

  const trendData = useMemo(() => {
    const numDays = 14;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const days = Array.from({ length: numDays }, (_, idx) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (numDays - 1 - idx));
      return {
        date,
        key: date.toISOString().slice(0, 10),
        updates: 0,
        assetsTouched: 0,
        publicUpdates: 0,
      };
    });

    const dayMap = new Map(days.map((day) => [day.key, day]));
    for (const project of projects) {
      const updatedDate = new Date(project.updatedAt);
      updatedDate.setHours(0, 0, 0, 0);
      const key = updatedDate.toISOString().slice(0, 10);
      const bucket = dayMap.get(key);
      if (bucket) {
        bucket.updates += 1;
        bucket.assetsTouched += project.assets;
        if (project.visibility === "PUBLIC") {
          bucket.publicUpdates += 1;
        }
      }
    }

    return days.map((day) => ({
      label: shortDayFormatter.format(day.date),
      fullLabel: longDayFormatter.format(day.date),
      updates: day.updates,
      assetsTouched: day.assetsTouched,
      publicUpdates: day.publicUpdates,
    }));
  }, [projects]);

  const metricStats = useMemo(() => {
    const recent = trendData.slice(-7);
    const previous = trendData.slice(0, 7);

    const sum = (rows: typeof trendData, key: MetricId) =>
      rows.reduce((acc, row) => acc + row[key], 0);

    const getChange = (key: MetricId) => {
      const current = sum(recent, key);
      const prior = sum(previous, key);
      if (prior === 0) return current === 0 ? 0 : 100;
      return ((current - prior) / prior) * 100;
    };

    return [
      {
        id: "updates" as const,
        label: "Updated",
        value: sum(recent, "updates"),
        change: getChange("updates"),
      },
      {
        id: "assetsTouched" as const,
        label: "Assets touched",
        value: sum(recent, "assetsTouched"),
        change: getChange("assetsTouched"),
      },
      {
        id: "publicUpdates" as const,
        label: "Public updates",
        value: sum(recent, "publicUpdates"),
        change: getChange("publicUpdates"),
      },
    ];
  }, [trendData]);

  const chartColor = "#06b6d4";

  const metricLabelMap: Record<MetricId, string> = {
    updates: "Updated projects",
    assetsTouched: "Assets touched",
    publicUpdates: "Public updates",
  };

  return (
    <Card className={cn("h-full p-3 pt-3.5", className)}>
      <CardContent className="space-y-4 p-2">
        <div className="grid gap-3 sm:grid-cols-3">
          {metricStats.map((metric) => (
            <button
              key={metric.id}
              type="button"
              onClick={() => setActiveMetric(metric.id)}
              className={cn(
                "rounded-xl p-4 text-left transition-colors",
                activeMetric === metric.id
                  ? "bg-muted/60"
                  : "bg-muted/30 hover:bg-muted/50",
              )}
            >
              <p className="text-muted-foreground text-sm font-medium">
                {metric.label}
              </p>
              <div className="mt-1.5 flex items-end gap-2">
                <p className="text-xl font-semibold leading-none tracking-tight">
                  {metric.value}
                </p>
                <p
                  className={cn(
                    "-mb-0.5 flex items-center text-sm font-medium",
                    metric.change > 0
                      ? "text-primary"
                      : metric.change < 0
                        ? "text-destructive"
                        : "text-muted-foreground",
                  )}
                >
                  {metric.change > 0 ? (
                    <ArrowUp className="mr-0.5 h-3.5 w-3.5" />
                  ) : metric.change < 0 ? (
                    <ArrowDown className="mr-0.5 h-3.5 w-3.5" />
                  ) : null}
                  {Math.abs(metric.change).toFixed(1)}%
                </p>
              </div>
            </button>
          ))}
        </div>

        <div className="rounded-xl bg-card pt-4">
          {projects.length === 0 ? (
            <div className="text-muted-foreground flex h-48 items-center justify-center text-sm">
              Create a project to see activity trends.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <AreaChart
                data={trendData}
                margin={{ top: 8, right: 8, left: -14, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id="projectUpdatesFill"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor={chartColor}
                      stopOpacity={0.35}
                    />
                    <stop
                      offset="95%"
                      stopColor={chartColor}
                      stopOpacity={0.05}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  minTickGap={28}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                />
                <Tooltip
                  formatter={(value) => {
                    const normalized = typeof value === "number" ? value : 0;
                    return [
                      `${normalized} ${normalized === 1 ? "unit" : "units"}`,
                      metricLabelMap[activeMetric],
                    ];
                  }}
                  labelFormatter={(label, payload) => {
                    const point = payload?.[0]?.payload as
                      | { fullLabel?: string }
                      | undefined;
                    return point?.fullLabel ?? label;
                  }}
                  contentStyle={{
                    backgroundColor: "var(--popover)",
                    borderColor: "var(--border)",
                    borderRadius: "0.6rem",
                    fontSize: "12px",
                    color: "var(--popover-foreground)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey={activeMetric}
                  stroke={chartColor}
                  strokeWidth={2}
                  fill="url(#projectUpdatesFill)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
