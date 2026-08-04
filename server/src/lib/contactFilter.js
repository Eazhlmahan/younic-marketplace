// Strips/flags likely phone numbers, emails, and common social handles from
// messages exchanged before a booking's identity is unlocked. This is a
// baseline regex filter for MVP — revisit with an ML-based approach if
// abuse patterns emerge once real usage data exists.

const PHONE_RE = /(\+?\d[\d\s\-().]{7,}\d)/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/g;
const HANDLE_RE = /(@[a-zA-Z0-9_.]{3,})|(\b(?:instagram|insta|ig|whatsapp|wa|telegram)\b\s*[:\-]?\s*\S+)/gi;

export function filterContactInfo(text) {
  if (!text) return { clean: text, flagged: false };
  let flagged = false;
  let clean = text
    .replace(PHONE_RE, () => { flagged = true; return '[contact hidden]'; })
    .replace(EMAIL_RE, () => { flagged = true; return '[contact hidden]'; })
    .replace(HANDLE_RE, () => { flagged = true; return '[contact hidden]'; });
  return { clean, flagged };
}
