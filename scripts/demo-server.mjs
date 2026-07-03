// The headline demo, for real. Run: `npm run build && npm run demo:serve`
// Then hit it with the curl commands in scripts/demo-script.md.
//
// A QUERY endpoint in ~5 lines, with correct body-aware caching: the second
// identical body is served from cache, and a DIFFERENT body never gets the
// wrong cached result.
import express from "express";
import { queryable, QueryCache } from "http-queryable/express";

const app = express();
app.use(queryable({ cache: new QueryCache({ defaultTtlMs: 60_000 }) }));

// Pretend "search" is expensive; count real executions to prove cache hits.
let executions = 0;
app.query("/search", (req, res) => {
  executions++;
  const q = req.body?.q ?? "";
  res.json({ query: q, results: [`result for "${q}"`], executions });
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`http-queryable demo listening on http://localhost:${port}`);
  console.log(
    `Try:  curl -sS -X QUERY localhost:${port}/search -H 'content-type: application/json' -d '{"q":"cats"}'`,
  );
});
