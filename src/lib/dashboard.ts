export function workerName() {
  return /^([^.]+)\.[^.]+\.workers\.dev$/.exec(location.hostname)?.[1];
}

function workerPageUrl(page: "settings" | "access") {
  const name = workerName();
  return name
    ? `https://dash.cloudflare.com/?to=/:account/workers/services/view/${name}/production/${page}`
    : "https://dash.cloudflare.com/?to=/:account/workers-and-pages";
}

export const workerSettingsUrl = () => workerPageUrl("settings");

export const workerAccessUrl = () => workerPageUrl("access");
