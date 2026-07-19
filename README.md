# pontypool-pickle

## Deployment (Netlify)

The site is a single static file, `public/index.html`. Netlify is configured
(via `netlify.toml`) to publish only the `public/` folder, so `README.md` and
the `supabase/` function source stay off the live site.

- **Publish directory:** `public`
- **Build command:** none — nothing to build, files are served as-is.

If you connect this repo to Netlify for continuous deployment, no dashboard
build settings are required — `netlify.toml` sets them automatically.
