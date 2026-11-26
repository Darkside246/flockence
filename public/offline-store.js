const name = "flockence-offline";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function openStorage() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("vault");
      request.result.createObjectStore("outbox");
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function storage(table, method, ...args) {
  const db = await openStorage();
  try {
    return await new Promise((resolve, reject) => {
      const readonly = method === "get" || method === "getAll" || method === "count";
      const tx = db.transaction(table, readonly ? "readonly" : "readwrite");
      const request = tx.objectStore(table)[method](...args);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function keyFrom(passphrase, salt) {
  const base = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: Uint8Array.from(salt), iterations: 600000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}

export async function seal(key, context, value) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: encoder.encode(context) },
    key, encoder.encode(JSON.stringify(value)),
  );
  return { nonce: Array.from(nonce), data: Array.from(new Uint8Array(data)) };
}

export async function open(key, context, value) {
  const bytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Uint8Array.from(value.nonce), additionalData: encoder.encode(context) },
    key, Uint8Array.from(value.data),
  );
  return JSON.parse(decoder.decode(bytes));
}
