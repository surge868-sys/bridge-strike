# Deploying BRIDGE STRIKE! to Vercel

The repo is a standard Next.js app (`src/app`), and the game assets are static files in
`public/`. It needs no environment variables, database or server code, so the Vercel
defaults work as is.

## One-time setup (about two minutes)

1. Go to https://vercel.com/new and sign in with GitHub.
2. Under **Import Git Repository**, pick `surge868-sys/bridge-strike`. If it isn't in the
   list, choose **Adjust GitHub App Permissions** and give Vercel access to that repo.
3. Leave everything as detected: Framework **Next.js**, root directory `./`, build
   command `next build`. Click **Deploy**.
4. Vercel gives you a URL like `bridge-strike-xyz.vercel.app`. Change it under
   Project → Settings → Domains (for example `bridge-strike.vercel.app` if it's free).

## After that

- Every push to the production branch redeploys. To deploy this branch, either merge it
  into `main` or set **Settings → Git → Production Branch** to
  `claude/eloquent-lovelace-3kfi0w`.
- Every other branch gets its own preview URL.
- The link preview (`public/og.jpg`) and the page title come from `src/app/layout.tsx`.
  On Vercel, `VERCEL_PROJECT_PRODUCTION_URL` makes the preview image link absolute.

## From the command line instead

```
npx vercel login
npx vercel --prod
```

This was not possible from the cloud session that built the game: its network policy
blocks `api.vercel.com`.
