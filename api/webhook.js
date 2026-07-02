// Vercel Serverless Function: relays GitHub's native "deployment_status"
// webhook (fired on the Student_Portal repo whenever Vercel updates the
// GitHub Deployment it creates for a Git-connected deploy) into a
// repository_dispatch event on VibhavKul/Student_Portal_Automation, which
// kicks off the Selenium suite.
//
// This listens for GitHub's own webhook, not a Vercel project webhook,
// because Vercel only exposes project-level webhooks on paid plans —
// GitHub Deployments are populated by Vercel even on the free Hobby plan.
//
// Required env vars (set in Vercel project settings, never committed):
//   GITHUB_WEBHOOK_SECRET - shared secret you choose yourself when creating
//                            the webhook in the Student_Portal repo's
//                            Settings -> Webhooks (enter the same value in
//                            both places)
//   GITHUB_PAT            - a GitHub Personal Access Token with `repo` scope

const crypto = require("crypto");

// Disable Vercel's automatic body parsing so we can access the raw request
// body — signature verification has to run against the exact bytes GitHub
// signed, not a re-serialized JSON.parse/stringify round trip.
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

const GITHUB_DISPATCH_URL =
  "https://api.github.com/repos/VibhavKul/Student_Portal_Automation/dispatches";

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function isValidSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  if (!signatureHeader.startsWith("sha256=")) return false;

  const received = signatureHeader.slice("sha256=".length);
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(received, "utf8");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawBody = await readRawBody(req);
  const signatureHeader = req.headers["x-hub-signature-256"];
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  console.log("[webhook] verifying signature...");
  if (!isValidSignature(rawBody, signatureHeader, secret)) {
    console.log("[webhook] signature verification FAILED");
    return res.status(401).json({ error: "Invalid signature" });
  }
  console.log("[webhook] signature verified OK");

  const githubEvent = req.headers["x-github-event"];
  console.log(`[webhook] X-GitHub-Event=${githubEvent}`);

  if (githubEvent === "ping") {
    console.log("[webhook] responding to ping");
    return res.status(200).json({ pong: true });
  }

  if (githubEvent !== "deployment_status") {
    console.log("[webhook] event ignored (not deployment_status)");
    return res.status(200).json({ ignored: true });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch (err) {
    console.log("[webhook] failed to parse JSON body");
    return res.status(400).json({ error: "Invalid JSON payload" });
  }

  const state = payload.deployment_status?.state;
  const environment = payload.deployment?.environment;
  const repoFullName = payload.repository?.full_name;

  // First real trigger: confirm this matches "production" and adjust the
  // isProduction check below if Vercel labels it differently.
  console.log(`[webhook] state=${state} environment=${environment} repo=${repoFullName}`);

  const isSuccess = state === "success";
  const isProduction = environment === "production";
  const isStudentPortal = repoFullName === "VibhavKul/Student_Portal";

  if (!isSuccess || !isProduction || !isStudentPortal) {
    console.log("[webhook] event ignored (filters did not match)");
    return res.status(200).json({ ignored: true });
  }

  const sha = payload.deployment?.sha || "";
  const targetUrl = payload.deployment_status?.target_url || "";

  const githubToken = process.env.GITHUB_PAT;
  if (!githubToken) {
    console.log("[webhook] GITHUB_PAT is not configured");
    return res.status(500).json({ error: "Server misconfigured" });
  }

  console.log("[webhook] dispatching repository_dispatch to Student_Portal_Automation...");
  try {
    const ghResponse = await fetch(GITHUB_DISPATCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        event_type: "vercel-deployment-succeeded",
        client_payload: {
          sha,
          url: targetUrl,
        },
      }),
    });

    if (!ghResponse.ok) {
      // GitHub's dispatches endpoint returns 204 with no body on success;
      // anything else is an error. Do not log response body/headers, they
      // can leak details tied to the token's permissions.
      console.log(`[webhook] GitHub dispatch failed with status ${ghResponse.status}`);
      return res.status(502).json({ error: "GitHub dispatch failed" });
    }

    console.log("[webhook] GitHub dispatch succeeded");
    return res.status(200).json({ dispatched: true });
  } catch (err) {
    console.log("[webhook] GitHub dispatch request threw an error");
    return res.status(502).json({ error: "GitHub dispatch failed" });
  }
};
