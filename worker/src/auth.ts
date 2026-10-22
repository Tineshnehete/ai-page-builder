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
