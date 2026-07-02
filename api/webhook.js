// Vercel Serverless Function: relays a Vercel "deployment succeeded" webhook
// for the Student_Portal project into a repository_dispatch event on
// VibhavKul/Student_Portal_Automation, which kicks off the Selenium suite.
//
// Required env vars (set in Vercel project settings, never committed):
//   VERCEL_WEBHOOK_SECRET - the signing secret shown when you create the
//                            webhook in the Vercel dashboard
//   GITHUB_PAT            - a GitHub Personal Access Token with `repo` scope

const crypto = require("crypto");

// Disable Vercel's automatic body parsing so we can access the raw request
// body — signature verification has to run against the exact bytes Vercel
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
  const expected = crypto
    .createHmac("sha1", secret)
    .update(rawBody)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signatureHeader, "utf8");
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawBody = await readRawBody(req);
  const signatureHeader = req.headers["x-vercel-signature"];
  const secret = process.env.VERCEL_WEBHOOK_SECRET;

  console.log("[webhook] verifying signature...");
  if (!isValidSignature(rawBody, signatureHeader, secret)) {
    console.log("[webhook] signature verification FAILED");
    return res.status(401).json({ error: "Invalid signature" });
  }
  console.log("[webhook] signature verified OK");

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch (err) {
    console.log("[webhook] failed to parse JSON body");
    return res.status(400).json({ error: "Invalid JSON payload" });
  }

  // NOTE: confirm the exact event name in the Vercel dashboard when you set
  // up the webhook — Vercel has used "deployment.succeeded" and
  // "deployment.ready" at different times/API versions.
  const eventType = payload.type || payload.event;
  const deployment = payload.payload || payload.deployment || {};
  const projectName =
    deployment.name ||
    deployment.project?.name ||
    payload.project?.name ||
    "";
  const target = deployment.target || payload.target;

  console.log(
    `[webhook] event=${eventType} project=${projectName} target=${target}`
  );

  const isSucceeded =
    eventType === "deployment.succeeded" || eventType === "deployment.ready";
  const isStudentPortal = projectName === "Student_Portal";
  const isProduction = target === "production";

  if (!isSucceeded || !isStudentPortal || !isProduction) {
    console.log("[webhook] event ignored (filters did not match)");
    return res.status(200).json({ ignored: true });
  }

  const deploymentId = deployment.id || deployment.deploymentId || "";
  const deploymentUrl = deployment.url || "";

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
          deployment_id: deploymentId,
          url: deploymentUrl,
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
