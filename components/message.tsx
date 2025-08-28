"use client";

import React, { useMemo } from "react";
import ItineraryCard, { ItineraryDraft } from "./ItineraryCard";

type Role = "user" | "assistant";
export type ChatMessage = {
  id: string;
  role: Role;
  content: string; // conserva tu forma actual
};

function parseCvBlock(content: string) {
  // Busca bloque con fence ```cv:itinerary ... ```
  const re = /```cv:itinerary\s*?\n([\s\S]*?)```/i;
  const m = content.match(re);
  if (!m) return null;
  try {
    const json = JSON.parse(m[1]);
    return { kind: "itinerary", data: json as ItineraryDraft };
  } catch {
    return null;
  }
}

export default function Message({
  msg,
}: {
  msg: ChatMessage;
}) {
  const parsed = useMemo(() => parseCvBlock(msg.content), [msg.content]);

  // Burbujas estándar
  const isAssistant = msg.role === "assistant";
  const bubble = (
    <div
      className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-3 text-sm ${
        isAssistant
          ? "bg-black/70 text-white border border-white/10"
          : "bg-amber-500 text-black"
      }`}
    >
      <div className="whitespace-pre-wrap break-words">{msg.content}</div>
    </div>
  );

  // Si trae bloque cv:itinerary, muéstralo bonito
  if (isAssistant && parsed?.kind === "itinerary") {
    return (
      <div className="flex gap-3 items-start my-3">
        <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-400/40" />
        <ItineraryCard data={parsed.data} />
      </div>
    );
  }

  // Mensaje normal
  return (
    <div
      className={`flex gap-3 items-start my-2 ${
        isAssistant ? "" : "justify-end flex-row-reverse"
      }`}
    >
      <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-400/40" />
      {bubble}
    </div>
  );
}
