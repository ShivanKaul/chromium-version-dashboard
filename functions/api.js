import { ok, fetchers, ciBrowsers } from "../lib/fetchers.js";

function fromEntry(name, entry, sourcePrefix) {
  return ok(
    name,
    entry.chromiumVersion || null,
    entry.chromiumMajor,
    "source: " + sourcePrefix + (entry.lastUpdated ? " (" + entry.lastUpdated + ")" : "")
  );
}

export async function onRequestGet(context) {
  let ciVersions = {};
  try {
    const cr = await context.env.ASSETS.fetch(
      new URL("/ci-versions.json", context.request.url)
    );
    if (cr.ok) ciVersions = await cr.json();
  } catch (_) {}

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const fetchedAt = Date.now();

  // Live-fetched browsers
  const livePromises = fetchers.map((x) => {
    return x.fn().then(
      (result) => writer.write(encoder.encode(JSON.stringify(result) + "\n")),
      (err) =>
        writer.write(
          encoder.encode(
            JSON.stringify({
              browser: x.name,
              chromiumVersion: null,
              chromiumMajor: null,
              source: null,
              error: err?.message || "Unknown error",
            }) + "\n"
          )
        )
    );
  });

  // CI-detected browsers
  const ciPromises = ciBrowsers.map((x) => {
    const ci = ciVersions[x.key];
    let result;
    if (ci?.chromiumMajor) {
      result = fromEntry(x.name, ci, ci.source || "CI");
    } else {
      result = {
        browser: x.name,
        chromiumVersion: null,
        chromiumMajor: null,
        source: null,
        error: "no version data available",
      };
    }
    return writer.write(encoder.encode(JSON.stringify(result) + "\n"));
  });

  Promise.all([...livePromises, ...ciPromises])
    .then(() =>
      writer.write(
        encoder.encode(JSON.stringify({ fetchedAt }) + "\n")
      )
    )
    .finally(() => writer.close());

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
