import { useEffect, useRef, useState } from "react";

import type { AccessEvent } from "../api/adminStats";
import { getToken } from "../auth/tokenStore";

export type FeedStatus = "connecting" | "live" | "reconnecting" | "unauthorized";

const MAX_EVENTS = 50;
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_FORBIDDEN = 4403;

function feedUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/ws/admin`;
}

interface FeedOptions {
  onEvent?: (event: AccessEvent) => void;
  createSocket?: (url: string) => WebSocket;
  pingMs?: number;
  maxBackoffMs?: number;
}

/**
 * Live gate decisions from /ws/admin. The JWT goes in the first message (never the URL,
 * which would end up in server logs). Reconnects with backoff after drops, but not after
 * an auth refusal (4401/4403).
 */
export function useAdminFeed({
  onEvent,
  createSocket = (url) => new WebSocket(url),
  pingMs = 25_000,
  maxBackoffMs = 30_000,
}: FeedOptions = {}) {
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const [events, setEvents] = useState<AccessEvent[]>([]);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const createRef = useRef(createSocket);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let stopped = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    function connect() {
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      const ws = createRef.current(feedUrl());
      socket = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: getToken() ?? "" }));
      ws.onmessage = (message: MessageEvent) => {
        let data: { type?: string; payload?: AccessEvent };
        try {
          data = JSON.parse(String(message.data)) as typeof data;
        } catch {
          return;
        }
        if (data.type === "connected") {
          attempt = 0;
          setStatus("live");
          clearInterval(pingTimer);
          pingTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
          }, pingMs);
        } else if (data.type === "access_event" && data.payload) {
          const event = data.payload;
          setEvents((previous) => [event, ...previous].slice(0, MAX_EVENTS));
          onEventRef.current?.(event);
        }
      };
      ws.onclose = (close: CloseEvent) => {
        clearInterval(pingTimer);
        if (stopped) return;
        if (close.code === CLOSE_UNAUTHORIZED || close.code === CLOSE_FORBIDDEN) {
          setStatus("unauthorized");
          return;
        }
        const delay = Math.min(1000 * 2 ** attempt, maxBackoffMs);
        attempt += 1;
        setStatus("reconnecting");
        retryTimer = setTimeout(connect, delay);
      };
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      socket?.close();
    };
  }, [pingMs, maxBackoffMs]);

  return { status, events };
}
