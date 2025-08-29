// lib/ai/tools/create-document.ts
// Versión con tipado laxo para evitar choques con UIMessagePart/toolCallId.
// No cambia la lógica, sólo relaja tipos para compilar en ai@beta.
type AnyObj = Record<string, any>;

export type CreateDocumentInput = {
  title?: string;
  content?: string;
  format?: "markdown" | "text" | "html";
  meta?: AnyObj;
};

export type CreateDocumentOutput = {
  ok: boolean;
  id?: string;
  url?: string;
  error?: string;
};

function randomId(prefix = "doc"): string {
  return `${prefix}_${Math.random().toString(36).slice(2)}`;
}

// Simulación de persistencia; ajusta a tu storage real si ya lo tienes
export async function createDocumentTool(input: CreateDocumentInput): Promise<CreateDocumentOutput> {
  try {
    const id = randomId();
    // Aquí iría tu persistencia real (DB/S3/etc).
    console.log(JSON.stringify({ level: "info", msg: "tool.createDocument", meta: { id, title: input?.title, len: input?.content?.length || 0 } }));
    return {
      ok: true,
      id,
      url: `/docs/${id}`, // opcional
    };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// Adaptador compatible con UIMessagePart sin exigir toolCallId estrictamente
export async function handleCreateDocumentMessage(message: any): Promise<AnyObj> {
  try {
    const parts: any[] = Array.isArray(message?.parts) ? message.parts : [];
    const data: CreateDocumentInput = (parts.find(p => p?.type === "json" || p?.mime === "application/json")?.data as any) || {};
    const res = await createDocumentTool(data);
    return { type: "tool-result", toolName: "create-document", ok: res.ok, id: res.id, url: res.url, error: res.error };
  } catch (e: any) {
    return { type: "tool-result", toolName: "create-document", ok: false, error: String(e?.message || e) };
  }
}
