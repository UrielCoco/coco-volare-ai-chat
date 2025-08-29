type Part = { role: "user" | "assistant"; text: string; at: number };

type Sess = {
  transcript: Part[];
  kommoLeadId?: number | null;
};

const SESS_MAP: Map<string, Sess> = (global as any).__cvSessMap || new Map();
(global as any).__cvSessMap = SESS_MAP;

export function getSess(sessionId: string): Sess {
  let s = SESS_MAP.get(sessionId);
  if (!s) {
    s = { transcript: [], kommoLeadId: null };
    SESS_MAP.set(sessionId, s);
  }
  return s;
}

export function appendPart(sessionId: string, role: "user" | "assistant", text: string) {
  const s = getSess(sessionId);
  s.transcript.push({ role, text, at: Date.now() });
}

export function setKommoLead(sessionId: string, leadId: number | null) {
  const s = getSess(sessionId);
  s.kommoLeadId = leadId;
}

export function buildTranscript(sessionId: string): string {
  const s = getSess(sessionId);
  return s.transcript
    .map(p => `${new Date(p.at).toISOString()} — ${p.role === "user" ? "Usuario" : "Asistente"}:\n${p.text}`)
    .join("\n\n");
}

export function getLeadId(sessionId: string): number | null | undefined {
  return getSess(sessionId).kommoLeadId ?? null;
}
