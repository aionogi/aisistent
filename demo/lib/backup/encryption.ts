import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, rm, type FileHandle } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { Decrypter, Encrypter } from "age-encryption";

export type BackupEncryptionOptions = { signal?: AbortSignal };
export type EncryptedFile = { bytes: number; sha256: string };

/** Only native, canonical X25519 recipients: no passphrases or private identities on a backup worker. */
export function validateRecipient(recipient: string): void {
  try {
    if (!/^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(recipient)) throw new Error();
    new Encrypter().addRecipient(recipient); // Validates the bech32 checksum and recipient length.
  } catch {
    throw new Error("A valid native age public recipient is required.");
  }
}

function webInput(input: Readable, signal?: AbortSignal): { stream: ReadableStream<Uint8Array>; cleanup: () => void } {
  // Count bytes rather than chunks, so buffering stays bounded for a pg_dump pipe.
  const stream = Readable.toWeb(input, { strategy: { highWaterMark: 64 * 1024, size: (chunk: Uint8Array) => chunk.byteLength } });
  const abort = () => { input.destroy(new Error("Backup stream aborted.")); };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  return {
    stream: stream as ReadableStream<Uint8Array>,
    cleanup: () => signal?.removeEventListener("abort", abort),
  };
}

async function discardOutput(handle: FileHandle | undefined, outputPath: string): Promise<void> {
  if (!handle) return; // Exclusive creation failed: never remove a pre-existing file or symlink.
  await handle.close().catch(() => {});
  await rm(outputPath, { force: true }).catch(() => { throw new Error("Incomplete backup output could not be removed."); });
}

// DOM and node:stream/web typings differ on async iterators; at runtime this
// is the same native ReadableStream class used by the age library on Node.
const nodeStream = (stream: ReadableStream<Uint8Array>) => Readable.fromWeb(stream as unknown as NodeReadableStream<Uint8Array>);

/**
 * Streams the standard age format directly to an exclusive private output file.
 * Only ciphertext reaches disk; the returned checksum describes those encrypted bytes.
 * The caller must publish the file only after its pg_dump process has also exited successfully.
 */
export async function encryptBackup(input: Readable, outputPath: string, recipient: string, options: BackupEncryptionOptions = {}): Promise<EncryptedFile> {
  const adapted = webInput(input, options.signal);
  let output: FileHandle | undefined;
  try {
    validateRecipient(recipient);
    output = await open(outputPath, "wx", 0o600);
    const encrypter = new Encrypter();
    encrypter.addRecipient(recipient);
    const encrypted = await encrypter.encrypt(adapted.stream);
    const checksum = createHash("sha256");
    let bytes = 0;
    const count = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        checksum.update(chunk);
        bytes += chunk.length;
        callback(null, chunk);
      },
    });
    await pipeline(nodeStream(encrypted), count, output.createWriteStream(), { signal: options.signal });
    return { bytes, sha256: checksum.digest("hex") };
  } catch {
    input.destroy();
    await discardOutput(output, outputPath);
    throw new Error("Backup encryption failed.");
  } finally {
    adapted.cleanup();
    await output?.close().catch(() => {});
  }
}

/**
 * Decrypts to a new file in the caller's isolated restore directory. age authenticates
 * every chunk and the end of the stream; a failed or truncated file leaves no plaintext.
 */
export async function decryptBackup(inputPath: string, outputPath: string, identity: string, options: BackupEncryptionOptions = {}): Promise<void> {
  const input = createReadStream(inputPath);
  const adapted = webInput(input, options.signal);
  let output: FileHandle | undefined;
  try {
    output = await open(outputPath, "wx", 0o600);
    const decrypter = new Decrypter();
    decrypter.addIdentity(identity);
    const decrypted = await decrypter.decrypt(adapted.stream);
    await pipeline(nodeStream(decrypted), output.createWriteStream(), { signal: options.signal });
  } catch {
    input.destroy();
    await discardOutput(output, outputPath);
    throw new Error("Backup decryption failed.");
  } finally {
    adapted.cleanup();
    input.destroy();
    await output?.close().catch(() => {});
  }
}
