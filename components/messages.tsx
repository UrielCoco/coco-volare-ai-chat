'use client';

import cx from 'classnames';
import { AnimatePresence, motion } from 'framer-motion';
import { memo, useState, useEffect } from 'react';
import type { Vote } from '@/lib/db/schema';
import { DocumentToolCall, DocumentToolResult } from './document';
import { PencilEditIcon, SparklesIcon } from './icons';
import { Markdown } from './markdown';
import { MessageActions } from './message-actions';
import { PreviewAttachment } from './preview-attachment';
import { Weather } from './weather';
import equal from 'fast-deep-equal';
import { cn, sanitizeText } from '@/lib/utils';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

/* .......................... resto de imports y código existente .......................... */

// Simple typewriter component for assistant messages
function TypewriterText({ text, speed = 15 }: { text: string; speed?: number }) {
  const [len, setLen] = useState(0);

  useEffect(() => {
    setLen(0);
  }, [text]);

  useEffect(() => {
    if (!text) return;
    // Reveal quickly: ~speed ms per char
    const step = () => setLen((prev) => (prev < text.length ? prev + 1 : prev));
    const id = setInterval(step, Math.max(5, speed));
    return () => clearInterval(id);
  }, [text, speed]);

  return <>{text.slice(0, len)}</>;
}

/* ------------------------------ PurePreviewMessage ------------------------------ */
const PurePreviewMessage = (/* tus props existentes aquí */) => {
  /* ... todo tu código previo sin cambios ... */

  return (
    /* ... dentro del mapeo de parts, localiza el bloque del bubble ... */
    <div
      className={cx(
        'flex flex-col gap-4 px-4 py-3 rounded-2xl shadow-md leading-relaxed',
        {
          'bg-[#c5a970] text-white rounded-br-none': message.role === 'user',
          'bg-[#000000] text-white rounded-bl-none': message.role === 'assistant',
        }
      )}
    >
      {message.role === 'assistant' ? (
        <Markdown>
          <TypewriterText text={sanitizeText(part.text)} speed={12} />
        </Markdown>
      ) : (
        <Markdown>{sanitizeText(part.text)}</Markdown>
      )}
    </div>
    /* ... resto del render ... */
  );
};

/* ------------------------------ memo export ------------------------------ */
export const PreviewMessage = memo(
  PurePreviewMessage,
  (prevProps, nextProps) => {
    if (prevProps.isLoading !== nextProps.isLoading) return false;
    if (prevProps.message.id !== nextProps.message.id) return false;
    if (prevProps.requiresScrollPadding !== nextProps.requiresScrollPadding) return false;
    if (!equal(prevProps.message.parts, nextProps.message.parts)) return false;
    if (!equal(prevProps.vote, nextProps.vote)) return false;
    return true;
  },
);
