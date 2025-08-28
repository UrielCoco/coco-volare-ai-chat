"use client";

import React from "react";
import Message, { ChatMessage } from "./message";

export default function Messages({ items }: { items: ChatMessage[] }) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((m) => (
        <Message key={m.id} msg={m} />
      ))}
    </div>
  );
}
