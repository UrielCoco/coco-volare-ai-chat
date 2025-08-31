// ... (todo igual a tu versión buena) ...

// dentro de handleStream, después de parsear `event`:
if (event === 'kommo') {
  try {
    const data = JSON.parse(dataLine || '{}');
    const ops = Array.isArray(data?.ops) ? data.ops : [];
    if (ops.length) {
      const rawKey = JSON.stringify(ops).slice(0, 40);
      // dedupe por hash simple
      if (!kommoHashesRef.current.has(rawKey)) {
        kommoHashesRef.current.add(rawKey);
        fetch('/api/kommo/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ops, threadId: threadIdRef.current }),
          keepalive: true,
        }).catch(() => {});
      }
    }
  } catch {}
  continue;
}
