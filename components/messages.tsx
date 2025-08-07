'use client';

import { AnimatePresence } from 'framer-motion';
import { Fragment } from 'react';
import type { Vote } from '@/lib/db/schema';
import type { ChatMessage } from '@/lib/types';
import { PreviewMessage } from './message';
import { ScrollAnchor } from './scroll-anchor';

export function Messages({
  chatId,
  messages,
  votes,
  status,
  setMessages,
  regenerate,
  isReadonly,
  isArtifactVisible,
}: {
  chatId: string;
  messages: ChatMessage[];
  votes?: Vote[];
  status: string;
  setMessages: (messages: ChatMessage[]) => void;
  regenerate: (messageId: string) => void;
  isReadonly: boolean;
  isArtifactVisible: boolean;
}) {
  return (
    <section className="flex flex-col w-full flex-1 overflow-y-auto overflow-x-hidden">
      <div className="w-full max-w-3xl mx-auto pb-4 md:pb-6 pt-4 md:pt-10 px-4">
        <AnimatePresence mode="popLayout">
          {messages.map((message, index) => (
            <Fragment key={message.id}>
              <PreviewMessage
                chatId={chatId}
                message={message}
                vote={votes?.find((v) => v.messageId === message.id)}
                isLoading
