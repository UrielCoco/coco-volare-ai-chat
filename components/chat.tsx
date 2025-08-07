'use client';

import { useEffect, useRef, useState } from 'react';
import Messages from './messages';
import type { ChatMessage } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';
import { PaperPlaneIcon } from '@radix-ui/react-icons';

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      parts: [{ type: 'text', text: input }],
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: {
            role: 'user',
            parts: [{ text: input }],
          },
          selectedChatModel: 'gpt-3.5-turbo',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) throw new Error('Error fetching response');

      const data = await response.json();

      const assistantMessage: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        parts: [{ type: 'text', text: data.reply || '…' }],
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Hubo un error al enviar el mensaje.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col w-full max-w-2xl h-[90vh] mx-auto border border-gray-200 rounded-2xl shadow-sm bg-gray-50 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6 font-serif">
        <Messages
          messages={messages}
          isLoading={loading}
          votes={[]}
          setMessages={setMessages}
          regenerate={async () => {}}
          isReadonly={false}
          chatId="local-chat"
        />
      </div>

      <form
        onSubmit={handleSubmit}
        className="p-4 border-t border-gray-200 bg-white flex gap-3 items-center"
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe tu mensaje..."
          className="flex-1 px-4 py-3 rounded-full border border-gray-300 bg-cream-100 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300 transition"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="bg-blue-500 hover:bg-blue-600 transition text-white rounded-full p-3 disabled:opacity-50"
        >
          {loading ? '...' : <PaperPlaneIcon className="w-5 h-5" />}
        </button>
      </form>
    </div>
  );
}
