# vercel-webhook-relay

Minimal, standalone Vercel Serverless Function. It receives GitHub's native
**`deployment_status`** webhook from the **Student_Portal** repo — fired
whenever Vercel updates the GitHub Deployment it creates for a production
deploy — verifies the request is genuinely from GitHub, and fires a
`repository_dispatch` event on `VibhavKul/Student_Portal_Automation` to kick
off its Selenium test suite.

This project is intentionally separate from `Student_Portal` and
`Student_Portal_Automation` — it's just a relay.

## Why GitHub's webhook instead of Vercel's

Vercel's own project-level webhooks require a paid Pro plan. On the free
Hobby plan, Vercel still creates a GitHub "Deployment" for every Git-connected
deploy and posts `deployment_status` events to that repo (visible as
deployment checks on commits) — this is GitHub's deployments API, not a
Vercel feature, so it works on Hobby too. This relay listens for that event
directly from GitHub instead.

## How it works

1. You configure a webhook in the `Student_Portal` GitHub repo's
   **Settings -> Webhooks**, subscribed to the "Deployment status" event,
   pointing at this relay's `/api/webhook` endpoint.
2. GitHub POSTs a `deployment_status` payload whenever a deployment's status
   changes (including a `ping` event once, when the webhook is first
   created).
3. The function verifies the `X-Hub-Signature-256` header (HMAC-SHA256 over
   the raw body, using `GITHUB_WEBHOOK_SECRET`) before doing anything else.
4. It checks the `X-GitHub-Event` header equals `deployment_status`
   (responding 200 immediately to `ping` so GitHub's webhook test succeeds,
   and ignoring any other event type).
5. It checks the payload's `deployment_status.state` is `"success"`, the
   `deployment.environment` is `"production"`, and `repository.full_name`
   is `VibhavKul/Student_Portal` — everything else is ignored (200 OK, no
   dispatch).
6. If all checks pass, it POSTs to GitHub's
   `repos/VibhavKul/Student_Portal_Automation/dispatches` endpoint using
   `GITHUB_PAT`, with `event_type: "vercel-deployment-succeeded"` and the
   commit SHA + deployment URL as `client_payload`.

## Environment variables

Set these in the Vercel project's dashboard (Project Settings ->
Environment Variables). Never commit real values — `.env.example` documents
the names only.

| Variable                | Description                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `GITHUB_WEBHOOK_SECRET`  | Shared secret you choose yourself (any random string) when creating the webhook in the `Student_Portal` repo's Settings -> Webhooks. |
| `GITHUB_PAT`             | GitHub Personal Access Token with `repo` scope, used to trigger the dispatch event.                                 |

## Local development

```bash
npm install -g vercel   # if you don't already have the CLI
cp .env.example .env    # fill in real values locally, never commit .env
vercel dev
```

## Deploying as its own Vercel project

1. Go to the [Vercel dashboard](https://vercel.com/dashboard) and click
   **Add New... -> Project**.
2. Import this GitHub repo (`VibhavKul/vercel-webhook-relay`) — keep it
   separate from the `Student_Portal` project.
3. Framework preset: choose **Other** (no build step needed).
4. Before deploying, expand **Environment Variables** and add:
   - `GITHUB_PAT` = your GitHub PAT (repo scope)
   - `GITHUB_WEBHOOK_SECRET` = leave a placeholder for now; you'll pick the
     real value yourself in step 3 of "Configuring the webhook" below, then
     come back and update it.
5. Click **Deploy**.
6. Once deployed, your function will be reachable at:
   `https://<your-project-name>.vercel.app/api/webhook`
   (Vercel shows the exact URL on the deployment's overview page.)

If you need to add or change environment variables after the initial
deploy: **Project -> Settings -> Environment Variables**, then redeploy (or
it will apply on the next deployment) for the change to take effect.

## Configuring the webhook in GitHub (on the Student_Portal repo)

This is a repo-level setting in GitHub, not a Vercel setting or a code
change.

1. Go to `github.com/VibhavKul/Student_Portal` -> **Settings -> Webhooks**.
2. Click **Add webhook**.
3. **Payload URL**: paste the function URL from the deploy step above, e.g.
   `https://vercel-webhook-relay-xyz.vercel.app/api/webhook`.
4. **Content type**: `application/json`.
5. **Secret**: enter any random string you choose (e.g. generate one with
   `openssl rand -hex 32`). Keep it — you'll need to enter this exact value
   as `GITHUB_WEBHOOK_SECRET` in the next step.
6. **Which events would you like to trigger this webhook?**: choose "Let me
   select individual events", then check **Deployment statuses** only
   (uncheck "Pushes" if it's checked by default).
7. Leave **Active** checked, click **Add webhook**. GitHub immediately sends
   a `ping` event — the function responds 200 to it, so you should see a
   green checkmark next to the new webhook in GitHub's webhook list.
8. Go to the `vercel-webhook-relay` project in Vercel -> **Settings ->
   Environment Variables**, and set `GITHUB_WEBHOOK_SECRET` to the same
   value you entered in step 5. Redeploy if prompted so the new value takes
   effect.
9. On the first real production deploy, check the function's logs (Vercel
   project -> **Deployments** -> your deployment -> **Functions** tab, or
   **Logs**) for the line `[webhook] state=... environment=... repo=...` to
   confirm Vercel labels the GitHub Deployment's environment as
   `"production"`. If it uses a different label, adjust the `isProduction`
   check in `api/webhook.js`.

## Security notes

- The function rejects any request whose signature doesn't verify, before
  parsing or acting on the payload.
- Secrets and tokens are never logged, including in error responses — only
  status codes and non-sensitive metadata (event type, state, environment,
  repo) are logged.
