// lib/types.ts
// -------- Itinerario --------
export type ItinItem = {
  time?: string;
  type?: 'flight' | 'transfer' | 'meal' | 'hotel' | 'activity' | 'ticket' | string;
  title: string;
  location?: string;
  notes?: string;
  price?: string | number;
};
export type ItinDay = {
  day?: number;
  date?: string;
  title?: string;
  items: ItinItem[];
};
export type Itinerary = {
  tripTitle?: string;
  days: ItinDay[];
};

// -------- Partes de mensaje (con campos “flex” para que casen con UIMessagePart genérico) --------
export type UITextPart = {
  type: 'text';
  // tus componentes aceptan string; añadimos index para compatibilidad con variantes { text: { value } }
  text: string;
  [k: string]: any; // <-- hace compatible con UIMessagePart<…>
};

export type UIFilePart = {
  type: 'file';
  url: string;
  filename?: string;
  // OBLIGATORIO (no opcional) para satisfacer el tipo que espera message.tsx
  mediaType: string;
  [k: string]: any; // compat extra
};

export type UIItineraryPart = {
  type: 'itinerary';
  itinerary: Itinerary;
  [k: string]: any; // compat extra
};

export type UIMessagePart = UITextPart | UIFilePart | UIItineraryPart;

// -------- Mensaje --------
// Importante: sin 'tool' para coincidir con tus componentes
export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: UIMessagePart[];
  createdAt?: string;
  // Compat con UIMessage<…> de tus componentes/librerías
  [k: string]: any;
};
