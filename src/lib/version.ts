declare const __APP_VERSION__: string;

export const APP_VERSION = __APP_VERSION__;

const REPO = "ozerkh/r2-lens";
export const REPO_URL = `https://github.com/${REPO}`;

type UpdateCheck =
  | { status: "latest" }
  | { status: "available"; version: string; url: string }
  | { status: "no-releases" };

function parse(version: string) {
  return version.replace(/^v/, "").split(/[.-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
}

function isNewer(candidate: string, current: string) {
  const [a, b] = [parse(candidate), parse(current)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

export async function checkForUpdate(): Promise<UpdateCheck> {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (response.status === 404) return { status: "no-releases" };
  if (!response.ok) throw new Error(`GitHub responded with ${response.status}`);
  const release = (await response.json()) as { tag_name: string; html_url: string };
  return isNewer(release.tag_name, APP_VERSION)
    ? { status: "available", version: release.tag_name.replace(/^v/, ""), url: release.html_url }
    : { status: "latest" };
}
