# matrx-apps

App corpus for the [MATRX renderer](https://github.com/koiosdigital/matrx-render).
Each top-level directory is one app: `manifest.json` + a TypeScript entry
(`app.ts`) authored against `@koiosdigital/matrx-sdk`, plus any binary assets
(imported as bytes).

## Developing

```sh
npm install
npx matrx dev <app>       # live preview on :8686 (LED view, config panel, hot reload)
npx matrx render <app>    # one-shot render to webp/png
npx matrx check <app>     # manifest + bundle policy + schema + determinism lint
npx matrx new <app-id>    # scaffold a new app

npm run typecheck         # tsc over all apps
npm run check             # matrx check over all apps (what CI enforces)
```

## CI / publishing

Every push and PR runs `matrx check` on each app; a failing app blocks the
merge. On push to `main`, each app is bundled (`matrx bundle`) and uploaded to
the `kd-matrx-apps` R2 bucket under the render Worker's registry keys.
Bundles are not versioned — each publish replaces the app's files in place:

```
apps/<id>/bundle.js        apps/<id>/manifest.json
```

The publish job uploads via the R2 S3 API and needs three repo secrets:
`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (from an R2 API token with write
on the bucket) and `CLOUDFLARE_ACCOUNT_ID` (forms the S3 endpoint URL).

## App layout

```
myapp/
  manifest.json   # id, name, summary, desc, author, allowedHosts, dependencies
  app.ts          # default export: (config) => RootSpec; optional getSchema()
                  # + named schema-handler exports (oauth2/generated/…)
  *.png, *.gif    # assets, imported as Uint8Array
```

npm dependencies used by an app must be declared in the repo `package.json`
AND listed in the app's manifest `dependencies` (vetting policy) — `matrx
check` enforces the latter.
