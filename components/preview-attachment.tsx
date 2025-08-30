'use client';

import React from 'react';

type Props = {
  fileName?: string;
  url?: string;
  sizeLabel?: string;
};

export default function PreviewAttachment({ fileName, url, sizeLabel }: Props) {
  if (!fileName && !url) return null;
  return (
    <a
      href={url || '#'}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-lg bg-zinc-800/50 text-zinc-100 px-3 py-2 hover:bg-zinc-800 transition"
    >
      <span className="i-mdi-paperclip" />
      <span className="font-medium">{fileName ?? 'Archivo'}</span>
      {sizeLabel ? <span className="text-xs opacity-70">· {sizeLabel}</span> : null}
    </a>
  );
}
