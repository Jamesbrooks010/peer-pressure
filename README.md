# Peer Pressure Prototype

A very early static prototype for private friend-group prediction markets.

Open `index.html` in a browser to run it locally. Data is currently stored in browser local storage unless Supabase shared mode is configured.

## Shared Supabase mode

1. Create a Supabase project.
2. Open the SQL editor and run `supabase-schema.sql`.
3. Copy your project URL and anon/publishable key into `supabase-config.js`.
4. Redeploy the static site.

Until those values are set, the app stays in local demo mode.
