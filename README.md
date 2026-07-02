# vercel-webhook-relay

Minimal, standalone Vercel Serverless Function. It receives a "deployment
succeeded" webhook from Vercel for the **Student_Portal** project's
production deployments, verifies the request is genuinely from Vercel, and
fires a `repository_dispatch` event on `VibhavKul/Student_Portal_Automation`
to kick off its Selenium test suite.

This project is intentionally separate from `Student_Portal` and
`Student_Portal_Automation` — it's just a relay.

## How it works

1. Vercel POSTs a webhook payload to `/api/webhook` whenever a deployment
   event happens (for any project the account owns, if using an
   account-level webhook).
2. The function verifies the `x-vercel-signature` header (HMAC-SHA1 over the
   raw body, using `VERCEL_WEBHOOK_SECRET`) before doing anything else.
3. It checks the payload is a "succeeded"/"ready" event, for the
   `Student_Portal` project, targeting `production` — everything else is
   ignored (200 OK, no dispatch).
4. If all checks pass, it POSTs to GitHub's
   `repos/VibhavKul/Student_Portal_Automation/dispatches` endpoint using
   `GITHUB_PAT`, with `event_type: "vercel-deployment-succeeded"`.

## Environment variables

Set these in the Vercel project's dashboard (Project Settings ->
Environment Variables). Never commit real values — `.env.example` documents
the names only.

| Variable                | Description                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `VERCEL_WEBHOOK_SECRET`  | Signing secret shown once when you create the webhook in the Vercel dashboard.                 |
| `GITHUB_PAT`             | GitHub Personal Access Token with `repo` scope, used to trigger the dispatch event.             |

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
   - `VERCEL_WEBHOOK_SECRET` = leave a placeholder for now; you'll generate
     the real value in step 2 of "Configuring the webhook" below, then come
     back and update it.
5. Click **Deploy**.
6. Once deployed, your function will be reachable at:
   `https://<your-project-name>.vercel.app/api/webhook`
   (Vercel shows the exact URL on the deployment's overview page.)

If you need to add or change environment variables after the initial
deploy: **Project -> Settings -> Environment Variables**, then redeploy (or
it will apply on the next deployment) for the change to take effect.

## Configuring the webhook in Vercel (for the Student_Portal project)

Vercel webhooks can be created at the account level (fires for all your
projects — this function filters to `Student_Portal` itself) or, on some
plans, scoped to a single project. Steps for the account-level flow:

1. Go to your **Account Settings** (click your avatar, top right ->
   **Account Settings**), then the **Webhooks** tab in the left sidebar.
   (If your plan/team exposes project-level webhooks instead, go to the
   `Student_Portal` project -> **Settings -> Webhooks** and use the same
   steps below.)
2. Click **Add Webhook** (or **Create Webhook**).
3. **URL**: paste the function URL from the deploy step above, e.g.
   `https://vercel-webhook-relay-xyz.vercel.app/api/webhook`.
4. **Events**: select the deployment-succeeded event. Vercel's naming has
   varied between `deployment.succeeded` and `deployment.ready` — pick
   whichever one is listed as firing when a deployment finishes
   successfully. The function checks for both names, so either works.
5. Click **Create**/**Save**. Vercel will show you a **signing secret**
   exactly once at this point — copy it immediately.
6. Go back to the `vercel-webhook-relay` project in Vercel -> **Settings ->
   Environment Variables**, and set `VERCEL_WEBHOOK_SECRET` to the value you
   just copied. Redeploy if prompted so the new value takes effect.

## Security notes

- The function rejects any request whose signature doesn't verify, before
  parsing or acting on the payload.
- Secrets and tokens are never logged, including in error responses — only
  status codes and non-sensitive metadata (event type, project name,
  target) are logged.
