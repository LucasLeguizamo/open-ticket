"use client";

/** Live ticker on the landing page — consumes /api/ticker (SSE, FR 13). */
import { useEffect, useState } from "react";

interface TickerLine {
  id: string;
  type: string;
  event_title: string;
  bought_by_agent: boolean | null;
  rail: string | null;
  at: string;
}

export function LiveTicker() {
  const [lines, setLines] = useState<TickerLine[]>([]);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/ticker");
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false); // EventSource reconnects on its own
    es.onmessage = (e) => {
      const line = JSON.parse(e.data) as TickerLine;
      setLines((prev) =>
        [...prev.filter((l) => l.id !== line.id), line].slice(-12),
      );
    };
    return () => es.close();
  }, []);

  return (
    <div className="rounded border border-neutral-800 bg-neutral-950 p-4">
      <p className="text-neutral-500">
        $ openticket ticker --follow{" "}
        <span className={live ? "text-green-500" : "text-yellow-500"}>
          [{live ? "live" : "reconnecting"}]
        </span>
      </p>
      <ul className="mt-2 space-y-1">
        {lines.length === 0 && (
          <li className="text-neutral-600">waiting for activity…</li>
        )}
        {[...lines].reverse().map((l) => (
          <li key={l.id}>
            <span className="text-neutral-600">
              {new Date(l.at).toISOString().slice(11, 19)}
            </span>{" "}
            {l.type === "order_confirmed" ? "🎟" : "•"} {l.event_title}
            {l.bought_by_agent && (
              <span className="text-green-500">
                {" "}
                ⚡ bought by agent ({l.rail})
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
