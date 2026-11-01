const OFFICIAL_CLOUD_BASE_URL = "https://hub.graphif.dev";

export function resolveCloudServiceBaseUrl(configured?: string): string | null {
  const value = configured?.trim();
  if (!value) return OFFICIAL_CLOUD_BASE_URL;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export const cloudServiceBaseUrl = resolveCloudServiceBaseUrl(import.meta.env.LR_API_BASE_URL);

export function cloudServiceUrl(path = ""): string {
  if (!cloudServiceBaseUrl) throw new Error("云服务地址配置无效，请使用完整的 HTTP 或 HTTPS 地址");
  return `${cloudServiceBaseUrl}/${path.replace(/^\/+/, "")}`;
}
