// Runs the signed-in app locally without external accounts: a temporary
// PostgreSQL database, a mock OpenID Connect provider instead of Auth0, and
// `next dev`. Every sign-in becomes the mock user "Ana Test".
//
//   npm run dev:local-auth            → http://127.0.0.1:4313/account/
//   MOCK_MFA=false npm run dev:local-auth   (sign-ins without MFA)
import { DEFAULT_MOCK_USER, startLocalAuthStack } from "../../tests/support/local-auth-stack.ts";

const appPort = Number(process.env.PORT ?? 4313);
const stack = await startLocalAuthStack({
  appPort,
  issuerPort: Number(process.env.MOCK_ISSUER_PORT ?? 4400),
  user: { ...DEFAULT_MOCK_USER, mfa: process.env.MOCK_MFA !== "false" },
});
console.log(`\nLocal sign-in stack ready: ${stack.appUrl}/account/ (mock issuer ${stack.issuerUrl}). Data is discarded on exit.\n`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await stack.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
