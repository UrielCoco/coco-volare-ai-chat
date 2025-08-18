CREATE TABLE IF NOT EXISTS "WebSessionThread" (
  "sessionId" uuid PRIMARY KEY,
  "threadId" varchar(128) NOT NULL,
  "channel" varchar(32) NOT NULL,
  "chatId" uuid,
  "createdAt" timestamp NOT NULL,
  "updatedAt" timestamp NOT NULL
);
