'use client';

import Message from './message';
import type { ChatMessage } from '@/lib/types';

export default function Messages({ items = [] }: { items?: ChatMessage[] }) {
  return (
    <div className="w-full">
      {items.map((m) => (
        <Message key={m.id} item={m} />
      ))}
    </div>
  );
}
