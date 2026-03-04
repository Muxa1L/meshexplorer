"use client";

import { useState, useMemo } from "react";
import { usePacketCountByType } from "@/hooks/useStats";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface PacketCountChartProps {
  region?: string;
}

// Color palette for different packet types
const COLORS: { [key: string]: string } = {
  REQ: "#FF6B6B",
  RESPONSE: "#4ECDC4",
  TXT_MSG: "#45B7D1",
  ACK: "#FFA07A",
  ADVERT: "#98D8C8",
  GRP_TXT: "#F7DC6F",
  GRP_DATA: "#BB8FCE",
  ANON_REQ: "#85C1E2",
  PATH: "#F8B88B",
  TRACE: "#ABEBC6",
  MULTIPART: "#F1948A",
  CONTROL: "#D2B4DE",
  RAW_CUSTOM: "#A9DFBF",
};

export default function PacketCountChart({ region }: PacketCountChartProps) {
  const [days, setDays] = useState(7);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  const query = usePacketCountByType(region, days);

  // Transform data for the chart: group by time, with each payload type as a series
  const chartData = useMemo(() => {
    if (!query.data?.data) return [];

    const dataByTime: { [time: string]: { time: string; [key: string]: any } } = {};

    query.data.data.forEach((row) => {
      if (!dataByTime[row.time]) {
        dataByTime[row.time] = { time: row.time };
      }
      dataByTime[row.time][row.payload_type_name] = row.count;
    });

    return Object.values(dataByTime).sort((a, b) =>
      new Date(a.time).getTime() - new Date(b.time).getTime()
    );
  }, [query.data?.data]);

  // Get unique payload types sorted by frequency
  const payloadTypes = useMemo(() => {
    if (!query.data?.data) return [];

    const typeCounts: { [key: string]: number } = {};
    query.data.data.forEach((row) => {
      typeCounts[row.payload_type_name] =
        (typeCounts[row.payload_type_name] || 0) + row.count;
    });

    return Object.entries(typeCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([type]) => type);
  }, [query.data?.data]);

  const handleLegendClick = (e: any) => {
    const dataKey = e.dataKey;
    const newHiddenSeries = new Set(hiddenSeries);
    if (newHiddenSeries.has(dataKey)) {
      newHiddenSeries.delete(dataKey);
    } else {
      newHiddenSeries.add(dataKey);
    }
    setHiddenSeries(newHiddenSeries);
  };

  const visiblePayloadTypes = payloadTypes.filter((type) => !hiddenSeries.has(type));

  const handleLegendRender = (props: any) => {
    const { payload } = props;
    return (
      <ul style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px" }}>
        {payload.map((entry: any, index: number) => {
          const isHidden = hiddenSeries.has(entry.dataKey);
          return (
            <li
              key={`legend-${index}`}
              style={{
                cursor: "pointer",
                color: isHidden ? "#999" : entry.color,
                textDecoration: isHidden ? "line-through" : "none",
                opacity: isHidden ? 0.6 : 1,
                padding: "4px 8px",
                borderRadius: "3px",
                fontSize: "12px",
              }}
              onClick={() => handleLegendClick({ dataKey: entry.dataKey })}
            >
              <span
                style={{
                  display: "inline-block",
                  width: "12px",
                  height: "2px",
                  backgroundColor: isHidden ? "#999" : entry.color,
                  marginRight: "6px",
                }}
              />
              {entry.dataKey}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="w-full">
      <div className="mb-4 flex gap-2 flex-wrap">
        <label className="text-sm text-gray-600 dark:text-gray-400 flex items-center mr-4">
          Time Period:
        </label>
        {[1, 7, 14, 30].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1 text-sm rounded border transition-colors ${
              days === d
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {d === 1 ? "1 Day" : `${d} Days`}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <div className="h-80 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-2"></div>
            <p className="text-gray-600 dark:text-gray-400">Loading chart data...</p>
          </div>
        </div>
      ) : query.error ? (
        <div className="h-80 flex items-center justify-center">
          <div className="text-red-600 dark:text-red-400">
            <p className="font-semibold">Error Loading Data</p>
            <p className="text-sm">{query.error.message}</p>
          </div>
        </div>
      ) : chartData.length === 0 ? (
        <div className="h-80 flex items-center justify-center">
          <p className="text-gray-600 dark:text-gray-400">No data available</p>
        </div>
      ) : (
        <div className="w-full h-96 bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d0d0d0" />
              <XAxis
                dataKey="time"
                stroke="#666"
                tick={{ fill: "#666", fontSize: 12 }}
              />
              <YAxis
                stroke="#666"
                tick={{ fill: "#666", fontSize: 12 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#fff",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  color: "#000",
                }}
              />
              <Legend content={handleLegendRender} wrapperStyle={{ cursor: "pointer" }} />
              {payloadTypes.map((type) => {
                const isHidden = hiddenSeries.has(type);
                return (
                  <Line
                    key={type}
                    type="monotone"
                    dataKey={type}
                    stroke={isHidden ? "#c0c0c0" : (COLORS[type] || "#888")}
                    strokeWidth={isHidden ? 1 : 2}
                    dot={false}
                    isAnimationActive={false}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
        <p>
          Showing packet count by type over the last {days} day{days > 1 ? "s" : ""}.
          Displaying {visiblePayloadTypes.length} of {payloadTypes.length} packet type{payloadTypes.length > 1 ? "s" : ""}.
          Click legend items to show/hide series.
        </p>
      </div>
    </div>
  );
}
