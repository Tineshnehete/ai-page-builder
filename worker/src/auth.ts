/**
 * Password hashing and verification using PBKDF2-SHA256 with the Web Crypto API.
 */

const SALT_LENGTH = 16; // 128 bits
const ITERATIONS = 100000; // OWASP recommends at least 100,000 iterations (2023)
const HASH_LENGTH = 32; // 256 bits for SHA256

/**
 * Hash a password using PBKDF2-SHA256.
 * @param password The password to hash
 * @returns An object containing the base64-encoded hash and salt
 */
export async function hashPassword(
  password: string
): Promise<{ hash: string; salt: string }> {
  // Generate a random salt
  const saltBytes = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const saltBase64 = bytesToBase64(saltBytes);

  // Import the password as a key
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  // Derive bits using PBKDF2-SHA256
  const hashBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBytes,
      iterations: ITERATIONS,
    },
    key,
    HASH_LENGTH * 8 // Convert bytes to bits
  );

  const hashBase64 = bytesToBase64(new Uint8Array(hashBits));

  return { hash: hashBase64, salt: saltBase64 };
}

/**
 * Verify a password against a hash and salt.
 * @param password The password to verify
 * @param hash The base64-encoded hash to compare against
 * @param salt The base64-encoded salt used in the hash
 * @returns True if the password matches, false otherwise
 */
export async function verifyPassword(
  password: string,
  hash: string,
  salt: string
): Promise<boolean> {
  // Decode the salt from base64
  const saltBytes = base64ToBytes(salt);

  // Import the password as a key
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  // Derive bits using PBKDF2-SHA256
  const hashBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBytes,
      iterations: ITERATIONS,
    },
    key,
    HASH_LENGTH * 8 // Convert bytes to bits
  );

  const computedHash = bytesToBase64(new Uint8Array(hashBits));

  // Use constant-time comparison to prevent timing attacks
  return constantTimeCompare(computedHash, hash);
}

/**
 * Convert a Uint8Array to a base64 string.
 */
function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Convert a base64 string to a Uint8Array.
 */
function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Compare two strings using constant-time comparison to prevent timing attacks.
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Convert a Uint8Array to a base64url string (RFC 4648 without padding).
 */
function bytesToBase64Url(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  // Replace standard base64 characters with base64url characters and remove padding
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Convert a base64url string to a Uint8Array (RFC 4648 without padding).
 */
function base64UrlToBytes(base64url: string): Uint8Array {
  // Add padding if needed
  const padding = 4 - (base64url.length % 4);
  const paddedBase64 =
    base64url.replace(/-/g, "+").replace(/_/g, "/") + (padding < 4 ? "=".repeat(padding) : "");

  const binaryString = atob(paddedBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Sign a session cookie with an HMAC-SHA256 signature.
 * @param username The username to include in the session
 * @param secret The secret key for HMAC signing
 * @param ttlSeconds The time-to-live in seconds
 * @returns A signed session cookie value in the format: base64url(payload) + "." + base64url(signature)
 */
export async function signSession(
  username: string,
  secret: string,
  ttlSeconds: number
): Promise<string> {
  // Create the payload with username and expiration time
  const now = Math.floor(Date.now() / 1000); // Convert to seconds
  const exp = now + ttlSeconds;
  const payload = { username, exp };

  // Encode payload to JSON and then to base64url
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadJson);
  const payloadBase64Url = bytesToBase64Url(payloadBytes);

  // Create HMAC-SHA256 signature
  const secretKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    secretKey,
    new TextEncoder().encode(payloadBase64Url)
  );

  const signatureBase64Url = bytesToBase64Url(new Uint8Array(signatureBytes));

  // Return cookie in the format: payload.signature
  return `${payloadBase64Url}.${signatureBase64Url}`;
}

/**
 * Verify a signed session cookie and extract the username.
 * @param cookieValue The signed session cookie value
 * @param secret The secret key used for HMAC signing
 * @returns An object with the username if valid, null if invalid or expired
 */
export async function verifySession(
  cookieValue: string,
  secret: string
): Promise<{ username: string } | null> {
  try {
    // Split the cookie into payload and signature
    const parts = cookieValue.split(".");
    if (parts.length !== 2) {
      return null;
    }

    const [payloadBase64Url, signatureBase64Url] = parts;

    // Verify the signature
    const secretKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const signatureBytes = base64UrlToBytes(signatureBase64Url);
    const isValid = await crypto.subtle.verify(
      "HMAC",
      secretKey,
      signatureBytes,
      new TextEncoder().encode(payloadBase64Url)
    );

    if (!isValid) {
      return null;
    }

    // Decode the payload
    const payloadBytes = base64UrlToBytes(payloadBase64Url);
    const payloadJson = new TextDecoder().decode(payloadBytes);
    const payload = JSON.parse(payloadJson) as { username: string; exp: number };

    // Check if the cookie has expired
    const now = Math.floor(Date.now() / 1000); // Convert to seconds
    if (payload.exp < now) {
      return null;
    }

    return { username: payload.username };
  } catch {
    // If anything fails during verification (invalid JSON, etc.), return null
    return null;
  }
}
